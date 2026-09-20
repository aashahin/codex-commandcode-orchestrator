import { test, expect } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Bridge } from "../src/delegate";
import { CommandCode } from "../src/commandcode";
import { createMcp } from "../src/mcp";
import { RECOVERY_GUIDANCE } from "../src/guidance";
import { fixture, dispose, sandboxWithCommand, task } from "./helpers";
const toolNames = [
  "cc_apply_worker_patch",
  "cc_cancel_worker",
  "cc_delegate",
  "cc_delegate_parallel",
  "cc_discard_worker",
  "cc_health",
  "cc_list_workers",
  "cc_models",
  "cc_worker_diff",
];
async function connect(mode: string, exit = 0, overrides = {}) {
  const box = await sandboxWithCommand(mode, exit, overrides);
  const bridge = new Bridge(
    box.config,
    new CommandCode(box.config),
    join(box.base, "state"),
    join(box.base, "cache"),
  );
  const server = createMcp(bridge);
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await client.connect(clientTransport);
  return { box, bridge, server, client };
}
const data = (result: unknown) =>
  (result as { structuredContent?: Record<string, unknown> }).structuredContent;
test("the bridge exposes the full cc_ tool surface", async () => {
  const { box, server, client } = await connect("success");
  try {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(toolNames);
    for (const tool of tools) expect(tool.description?.length ?? 0).toBeGreaterThan(20);
  } finally {
    await client.close();
    await server.close();
    await dispose(box.base);
  }
});
test("cc_models and cc_health answer over the MCP transport", async () => {
  const { box, server, client } = await connect("success");
  try {
    const models = data(await client.callTool({ name: "cc_models" })) as {
      models: Array<{ id: string }>;
      routing: Record<string, { model: string } | null>;
      note: string;
      source: string;
    };
    expect(models.source).toBe("cmd --list-models");
    expect(models.models.map((m) => m.id)).toContain(
      "moonshotai/kimi-k2.7-code",
    );
    expect(models.routing.reviewer).toEqual({ model: "qwen/qwen3.8-max" });
    expect(models.note).toContain("BYOK");
    const health = data(await client.callTool({ name: "cc_health" })) as {
      runtime: { binary: string };
      bridge: { version: string };
    };
    expect(health.runtime.binary).toBe(box.config.command!);
    expect(health.bridge.version).toBe("0.1.0");
  } finally {
    await client.close();
    await server.close();
    await dispose(box.base);
  }
});
test("a worker round trips through MCP: delegate, diff, apply, discard", async () => {
  const repo = await fixture();
  const { box, server, client } = await connect("write");
  try {
    const delegated = data(
      await client.callTool({
        name: "cc_delegate",
        arguments: task(repo),
      }),
    ) as { id: string; status: string; patchAvailable: boolean };
    expect(delegated.status).toBe("completed");
    expect(delegated.patchAvailable).toBe(true);
    const diff = data(
      await client.callTool({
        name: "cc_worker_diff",
        arguments: { id: delegated.id, offset: 0, limit: 48000 },
      }),
    ) as { patch: string; reviewToken?: string; changedFiles: string[] };
    expect(diff.patch).toContain("+changed by worker");
    expect(diff.reviewToken).toBeDefined();
    const applied = data(
      await client.callTool({
        name: "cc_apply_worker_patch",
        arguments: {
          id: delegated.id,
          repoDir: repo,
          reviewToken: diff.reviewToken!,
        },
      }),
    ) as { status: string };
    expect(applied.status).toBe("applied");
    expect(await readFile(join(repo, "a.txt"), "utf8")).toBe(
      "changed by worker\n",
    );
    const discarded = data(
      await client.callTool({
        name: "cc_discard_worker",
        arguments: { id: delegated.id, discardPatch: true },
      }),
    ) as { status: string };
    expect(discarded.status).toBe("discarded");
    const listed = data(await client.callTool({ name: "cc_list_workers" })) as {
      workers: unknown[];
    };
    expect(listed.workers).toHaveLength(0);
  } finally {
    await client.close();
    await server.close();
    await dispose(repo);
    await dispose(box.base);
  }
});
test("a rejected tool call returns recovery guidance", async () => {
  const repo = await fixture();
  const { box, server, client } = await connect("write");
  try {
    const delegated = data(
      await client.callTool({ name: "cc_delegate", arguments: task(repo) }),
    ) as { id: string };
    const failure = (await client.callTool({
      name: "cc_apply_worker_patch",
      arguments: { id: delegated.id, repoDir: repo, reviewToken: "b".repeat(64) },
    })) as { isError?: boolean; content: Array<{ text: string }> };
    expect(failure.isError).toBe(true);
    expect(failure.content[0]!.text).toContain("Inspect the complete patch");
    expect(failure.content[0]!.text).toContain(RECOVERY_GUIDANCE);
  } finally {
    await client.close();
    await server.close();
    await dispose(repo);
    await dispose(box.base);
  }
});
test("parallel delegation is reachable through MCP with isolation", async () => {
  const repo = await fixture();
  const { box, server, client } = await connect("write");
  try {
    const outcome = data(
      await client.callTool({
        name: "cc_delegate_parallel",
        arguments: {
          tasks: [task(repo, { task: "one" }), task(repo, { task: "two" })],
          concurrency: 2,
        },
      }),
    ) as {
      results: Array<{ status: string; worktree?: string }>;
      concurrency: number;
    };
    expect(outcome.concurrency).toBe(1);
    expect(outcome.results).toHaveLength(2);
    for (const result of outcome.results) expect(result.status).toBe("completed");
    expect(new Set(outcome.results.map((r) => r.worktree)).size).toBe(2);
  } finally {
    await client.close();
    await server.close();
    await dispose(repo);
    await dispose(box.base);
  }
});
test("zero-argument tools answer with and without an arguments field", async () => {
  const { box, server, client } = await connect("success");
  try {
    expect(
      data(await client.callTool({ name: "cc_list_workers", arguments: {} })),
    ).toEqual({ workers: [] });
    const withoutArguments = data(
      await client.callTool({ name: "cc_list_workers" } as never),
    );
    expect(withoutArguments).toEqual({ workers: [] });
    expect(
      data(await client.callTool({ name: "cc_health" } as never)),
    ).toMatchObject({ bridge: { version: "0.1.0" } });
  } finally {
    await client.close();
    await server.close();
    await dispose(box.base);
  }
});
test("a schema-level rejection is reported as an error", async () => {
  const repo = await fixture();
  const { box, server, client } = await connect("success");
  try {
    const failure = (await client.callTool({
      name: "cc_delegate",
      arguments: { task: "", repoDir: repo },
    })) as { isError?: boolean };
    expect(failure.isError).toBe(true);
  } finally {
    await client.close();
    await server.close();
    await dispose(repo);
    await dispose(box.base);
  }
});
test("a semantic rejection carries recovery guidance", async () => {
  const repo = await fixture();
  const { box, server, client } = await connect("success");
  try {
    const failure = (await client.callTool({
      name: "cc_delegate",
      arguments: task(repo, { role: "explorer", mode: "write_isolated" }),
    })) as { isError?: boolean; content: Array<{ text: string }> };
    expect(failure.isError).toBe(true);
    expect(failure.content[0]!.text).toContain("must be read-only");
    expect(failure.content[0]!.text).toContain(RECOVERY_GUIDANCE);
  } finally {
    await client.close();
    await server.close();
    await dispose(repo);
    await dispose(box.base);
  }
});
