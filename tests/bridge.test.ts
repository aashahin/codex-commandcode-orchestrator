import { test, expect } from "bun:test";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Bridge } from "../src/delegate";
import { CommandCode } from "../src/commandcode";
import { State } from "../src/state";
import { fixture, dispose, sandbox, sandboxWithCommand, task } from "./helpers";
async function bridge(mode: string, exit = 0, overrides = {}) {
  const box = await sandboxWithCommand(mode, exit, overrides);
  return {
    box,
    bridge: new Bridge(
      box.config,
      new CommandCode(box.config),
      join(box.base, "state"),
      join(box.base, "cache"),
    ),
  };
}
test("a write worker is snapshotted, collected and applied after review", async () => {
  const repo = await fixture();
  const { box, bridge: b } = await bridge("write");
  try {
    const result = await b.delegate(task(repo));
    expect(result.status).toBe("completed");
    expect(result.changedFiles).toContain("a.txt");
    expect(result.patchAvailable).toBe(true);
    expect(result.patchId).toBe(result.id);
    expect(result.modelVerified).toBe(false);
    expect(result.summary).toBe("fake summary");
    expect(result.findings[0].kind).toBe("FACT");
    expect(result.workerTestClaims[0].independentlyVerified).toBe(false);
    expect(result.exitCode).toBe(0);
    expect(result.sessionID).toBe("sess-fake-0001");
    expect(result.tools.map((t) => t.name)).toContain("read_file");
    expect(await readFile(join(repo, "a.txt"), "utf8")).toBe("base\n");
    const diff = await b.diff(result.id, 0, 48000);
    expect(diff.patch).toContain("+changed by worker");
    expect(diff.reviewToken).toHaveLength(64);
    const applied = await b.apply(result.id, repo, diff.reviewToken!);
    expect(applied.status).toBe("applied");
    expect(applied.warning).toContain("No commit was created");
    expect(await readFile(join(repo, "a.txt"), "utf8")).toBe(
      "changed by worker\n",
    );
  } finally {
    await dispose(repo);
    await dispose(box.base);
  }
});
test("applying without reading the whole patch is refused", async () => {
  const repo = await fixture();
  const { box, bridge: b } = await bridge("write");
  try {
    const result = await b.delegate(task(repo));
    await expect(b.apply(result.id, repo, "a".repeat(64))).rejects.toThrow(
      "Inspect the complete patch",
    );
    expect(await readFile(join(repo, "a.txt"), "utf8")).toBe("base\n");
  } finally {
    await dispose(repo);
    await dispose(box.base);
  }
});
test("the guardrail overlay never reaches the patch and user settings survive", async () => {
  const repo = await fixture();
  await mkdir(join(repo, ".commandcode"), { recursive: true });
  await writeFile(
    join(repo, ".commandcode", "settings.json"),
    '{"permissions":{"allow":["Shell(*)"]}}\n',
  );
  const { box, bridge: b } = await bridge("write");
  try {
    const result = await b.delegate(task(repo));
    expect(result.status).toBe("completed");
    expect(result.changedFiles).toEqual(["a.txt"]);
    const diff = await b.diff(result.id, 0, 48000);
    expect(diff.patch).not.toContain(".commandcode");
    expect(
      await readFile(join(repo, ".commandcode", "settings.json"), "utf8"),
    ).toBe('{"permissions":{"allow":["Shell(*)"]}}\n');
  } finally {
    await dispose(repo);
    await dispose(box.base);
  }
});
test("guardrails can be disabled and leave no overlay behind", async () => {
  const repo = await fixture();
  const { box, bridge: b } = await bridge("write", 0, { guardrails: false });
  try {
    const result = await b.delegate(task(repo, { mode: "read_only" }));
    expect(result.status).toBe("failed");
    expect(
      result.warnings.some((w) => w.includes("Read-only worker changed files")),
    ).toBe(true);
    expect(result.changedFiles).toEqual(["a.txt"]);
  } finally {
    await dispose(repo);
    await dispose(box.base);
  }
});
test("explorers and reviewers cannot request a write mode", async () => {
  const repo = await fixture();
  const { box, bridge: b } = await bridge("success");
  try {
    await expect(
      b.delegate(task(repo, { role: "explorer", mode: "write_isolated" })),
    ).rejects.toThrow("must be read-only");
    await expect(
      b.delegate(task(repo, { role: "reviewer", mode: "write_isolated" })),
    ).rejects.toThrow("must be read-only");
  } finally {
    await dispose(repo);
    await dispose(box.base);
  }
});
test("an unread patch is preserved by discard and only dropped when asked", async () => {
  const repo = await fixture();
  const { box, bridge: b } = await bridge("write");
  try {
    const result = await b.delegate(task(repo));
    const preserved = await b.discard(result.id);
    expect(preserved.status).toBe("preserved");
    expect((await b.diff(result.id, 0, 48000)).patchAvailable).toBe(true);
    const dropped = await b.discard(result.id, true);
    expect(dropped.status).toBe("discarded");
    expect((await b.state.list()).find((w) => w.id === result.id)).toBeUndefined();
  } finally {
    await dispose(repo);
    await dispose(box.base);
  }
});
test("a successful worker keeps its patch after discard unless dropped", async () => {
  const repo = await fixture();
  const { box, bridge: b } = await bridge("write");
  try {
    const result = await b.delegate(task(repo));
    const diff = await b.diff(result.id, 0, 48000);
    await b.apply(result.id, repo, diff.reviewToken!);
    const discarded = await b.discard(result.id, true);
    expect(discarded.status).toBe("discarded");
    expect(await readFile(join(repo, "a.txt"), "utf8")).toBe(
      "changed by worker\n",
    );
  } finally {
    await dispose(repo);
    await dispose(box.base);
  }
});
test("a worker failure is reported with an exit code and recovery guidance", async () => {
  const repo = await fixture();
  const { box, bridge: b } = await bridge("error", 10);
  try {
    const result = await b.delegate(task(repo));
    expect(result.status).toBe("failed");
    expect(result.exitCode).toBe(10);
    expect(result.recovery).toContain("cc_health");
    expect(result.warnings.some((w) => w.includes("credits"))).toBe(true);
    const listed = (await b.state.list()).find((w) => w.id === result.id);
    expect(listed?.status).toBe("failed");
    expect(listed?.exitCode).toBe(10);
    expect(listed?.usage).toEqual({ inputTokens: 1, outputTokens: 0 });
  } finally {
    await dispose(repo);
    await dispose(box.base);
  }
});
test("a failed worker still reports no patch when it made no changes", async () => {
  const repo = await fixture();
  const { box, bridge: b } = await bridge("error", 4);
  try {
    const result = await b.delegate(task(repo));
    expect(result.status).toBe("failed");
    expect(result.patchAvailable).toBe(false);
    expect(result.patchId).toBeUndefined();
    expect((await b.diff(result.id)).patchAvailable).toBe(false);
  } finally {
    await dispose(repo);
    await dispose(box.base);
  }
});
test("cancelling a live worker reports a cancellation request", async () => {
  const repo = await fixture();
  const { box, bridge: b } = await bridge("hang");
  try {
    const pending = b.delegate(task(repo));
    await new Promise((resolve) => setTimeout(resolve, 400));
    const id = (await b.state.list()).find((w) => w.status === "running")!.id;
    expect(await b.cancel(id)).toEqual({
      id,
      status: "cancellation_requested",
    });
    const result = await pending;
    expect(result.status).toBe("cancelled");
    expect(await b.cancel(id)).toMatchObject({ id });
  } finally {
    await dispose(repo);
    await dispose(box.base);
  }
});
test("parallel workers each get their own isolated worktree", async () => {
  const repo = await fixture();
  const { box, bridge: b } = await bridge("write");
  try {
    const outcome = await b.delegateParallel(
      [task(repo, { task: "one" }), task(repo, { task: "two" })],
      2,
    );
    expect(outcome.results).toHaveLength(2);
    const worktrees = new Set(
      outcome.results.map((r) => (r as { worktree?: string }).worktree),
    );
    expect(worktrees.size).toBe(2);
    for (const result of outcome.results)
      expect((result as { status: string }).status).toBe("completed");
    expect(await readFile(join(repo, "a.txt"), "utf8")).toBe("base\n");
  } finally {
    await dispose(repo);
    await dispose(box.base);
  }
});
test("parallelism is capped and rejects an out-of-range batch", async () => {
  const repo = await fixture();
  const { box, bridge: b } = await bridge("success");
  try {
    await expect(b.delegateParallel([], 2)).rejects.toThrow("1–16");
    await expect(
      b.delegateParallel(Array.from({ length: 17 }, () => task(repo)), 2),
    ).rejects.toThrow("1–16");
    const outcome = await b.delegateParallel([task(repo)], 8);
    expect(outcome.concurrency).toBe(1);
  } finally {
    await dispose(repo);
    await dispose(box.base);
  }
});
test("a record left running by a previous bridge is reconciled as cancelled", async () => {
  const repo = await fixture();
  const { box, bridge: b } = await bridge("success");
  const state = new State(box.state);
  const id = randomUUID();
  await state.save({
    id,
    role: "implementer",
    model: "deepseek/deepseek-v4-flash",
    status: "running",
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
    changedFiles: [],
  });
  try {
    await b.reconcile();
    const record = await state.get(id);
    expect(record.status).toBe("cancelled");
    expect(record.warning).toContain("Bridge restarted");
    expect(await b.cancel(id)).toMatchObject({ status: "cancelled" });
  } finally {
    await dispose(repo);
    await dispose(box.base);
  }
});
test("health reports the bridge, routing and worker counts without touching auth", async () => {
  const repo = await fixture();
  const { box, bridge: b } = await bridge("write");
  try {
    await b.delegate(task(repo));
    const health = (await b.health()) as {
      runtime: { binary: string; version?: string };
      bridge: { version: string; guardrails: boolean; parallelism: number };
      routing: Record<string, { model: string; effort?: string } | null>;
      models: { source: string };
      workers: { total: number; counts: Record<string, number> };
    };
    expect(health.runtime.binary).toBe(box.config.command!);
    expect(health.runtime.version).toBe("fake-cmd 0.0.0");
    expect(health.bridge.version).toBe("0.1.0");
    expect(health.bridge.guardrails).toBe(true);
    expect(health.bridge.parallelism).toBe(1);
    expect(health.models.source).toBe("cmd --list-models");
    expect(health.routing.implementer).toEqual({
      model: "moonshotai/kimi-k2.7-code",
    });
    expect(health.workers.counts.completed).toBe(1);
  } finally {
    await dispose(repo);
    await dispose(box.base);
  }
});
test("cc_models reports the live ids cmd advertises", async () => {
  const { box, bridge: b } = await bridge("success");
  try {
    const models = (await b.models()) as {
      routing: Record<string, { model: string; effort?: string } | null>;
      models: Array<{ id: string; shortName: string; efforts?: string[] }>;
      efforts: string[];
      source: string;
      warning?: string;
    };
    expect(models.source).toBe("cmd --list-models");
    expect(models.warning).toBeUndefined();
    expect(models.models.map((m) => m.id)).toContain(
      "moonshotai/kimi-k2.7-code",
    );
    expect(models.efforts).toEqual(["low", "medium", "high", "xhigh", "max"]);
    expect(models.routing.explorer).toEqual({
      model: "deepseek/deepseek-v4-flash",
    });
    expect(models.routing.reviewer).toEqual({ model: "qwen/qwen3.8-max" });
  } finally {
    await dispose(box.base);
  }
});
test("closing the bridge aborts queued work and cancels nothing else", async () => {
  const repo = await fixture();
  const { box, bridge: b } = await bridge("hang");
  try {
    const pending = b.delegate(task(repo));
    await new Promise((resolve) => setTimeout(resolve, 300));
    await b.close();
    const result = await pending;
    expect(result.status).toBe("cancelled");
    expect(() => b.delegate(task(repo))).toThrow("shutting down");
  } finally {
    await dispose(repo);
    await dispose(box.base);
  }
});
