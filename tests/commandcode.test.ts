import { test, expect } from "bun:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { TaskSchema, type Config } from "../src/config";
import { CommandCode, classify, workerArgs } from "../src/commandcode";
import { choose } from "../src/router";
import {
  config as defaultConfig,
  sandboxWithCommand,
  dispose,
} from "./helpers";
async function worktree() {
  return mkdtemp("/tmp/cc-work-");
}
async function run(
  mode: string,
  exit = 0,
  input: { mode?: "read_only" | "write_isolated" } = {},
) {
  const box = await sandboxWithCommand(mode, exit);
  const dir = await worktree();
  const task = TaskSchema.parse({
    task: "Change a.txt",
    role: "implementer",
    repoDir: dir,
    mode: input.mode ?? "write_isolated",
  });
  const model = choose("implementer", box.config);
  const runtime = new CommandCode(box.config);
  const result = await runtime.run(
    task,
    model,
    dir,
    AbortSignal.timeout(30000),
    async () => {},
  );
  return { box, dir, result };
}
test("exit codes map to worker statuses", () => {
  const ok = { type: "result" as const, subtype: "success" };
  expect(classify(0, ok, undefined).status).toBe("completed");
  expect(classify(1, undefined, undefined).status).toBe("failed");
  expect(classify(3, undefined, undefined).status).toBe("failed");
  expect(classify(3, undefined, undefined).message).toContain(
    "not authenticated",
  );
  expect(classify(4, undefined, undefined).message).toContain("denied");
  expect(classify(8, undefined, undefined).status).toBe("completed");
  expect(classify(8, undefined, undefined).truncated).toBe(true);
  expect(classify(10, undefined, undefined).message).toContain("credits");
  expect(classify(130, undefined, undefined).status).toBe("cancelled");
  expect(classify(42, undefined, undefined).message).toContain("42");
  expect(classify(0, { type: "result", subtype: "error" }, undefined).status).toBe(
    "failed",
  );
  expect(classify(0, ok, "timeout").status).toBe("timed_out");
  expect(classify(0, ok, "cancel").status).toBe("cancelled");
});
test("read_only workers use plan mode and write workers get --yolo", () => {
  const model = choose("explorer", defaultConfig);
  const readOnly = workerArgs(
    TaskSchema.parse({ task: "x", repoDir: "/tmp", mode: "read_only" }),
    model,
    "/worktree",
    defaultConfig,
  );
  expect(readOnly).toContain("--permission-mode");
  expect(readOnly[readOnly.indexOf("--permission-mode") + 1]).toBe("plan");
  expect(readOnly).not.toContain("--yolo");
  const write = workerArgs(
    TaskSchema.parse({ task: "x", repoDir: "/tmp", mode: "write_isolated" }),
    model,
    "/worktree",
    defaultConfig,
  );
  expect(write).toContain("--yolo");
  expect(write).not.toContain("--permission-mode");
  for (const args of [readOnly, write]) {
    expect(args[0]).toBe("-p");
    expect(args[1]).toContain("Codex principal orchestrator");
    expect(args[1]).toContain("/worktree");
    expect(args).toContain("--output-format");
    expect(args).toContain("--trust");
    expect(args).toContain("--skip-onboarding");
    expect(args[args.indexOf("--model") + 1]).toBe(model.key);
  }
});
test("worker args honour max turns, effort, extra args and tool opt-ins", () => {
  const overridden: Config = { ...defaultConfig, maxTurns: 12, extraArgs: ["--config", "theme=dark"], toolsEnable: ["todo_write"] };
  const model = choose("implementer", overridden, "gpt-5.6-sol", "xhigh");
  expect(model.key).toBe("gpt-5.6-sol:xhigh");
  const args = workerArgs(
    TaskSchema.parse({ task: "x", repoDir: "/tmp", mode: "write_isolated" }),
    model,
    "/w",
    overridden,
  );
  expect(args[args.indexOf("--max-turns") + 1]).toBe("12");
  expect(args[args.indexOf("--model") + 1]).toBe("gpt-5.6-sol:xhigh");
  expect(args[args.indexOf("--tools-enable") + 1]).toBe("todo_write");
  expect(args.slice(-2)).toEqual(["--config", "theme=dark"]);
  const perTask = workerArgs(
    TaskSchema.parse({ task: "x", repoDir: "/tmp", mode: "write_isolated", maxTurns: 5 }),
    model,
    "/w",
    overridden,
  );
  expect(perTask[perTask.indexOf("--max-turns") + 1]).toBe("5");
});
test("successful run parses the result frame, session and tools", async () => {
  const { box, dir, result } = await run("success");
  try {
    expect(result.status).toBe("completed");
    expect(result.sessionID).toBe("sess-fake-0001");
    expect(result.stopReason).toBe("end_turn");
    expect(result.truncated).toBe(false);
    expect(result.usage).toEqual({ inputTokens: 11, outputTokens: 22 });
    expect(result.durationMs).toBe(7);
    expect(result.exitCode).toBe(0);
    expect(result.tools.map((t) => t.name)).toContain("read_file");
    expect(JSON.parse(result.text).summary).toBe("fake summary");
    expect(result.warnings).toEqual([]);
  } finally {
    await dispose(box.base);
    await dispose(dir);
  }
});
test("unknown frames and unparseable lines are tolerated, never fatal", async () => {
  const { box, dir, result } = await run("garbage");
  try {
    expect(result.status).toBe("completed");
    expect(
      result.warnings.some((w) => w.includes("not valid JSON")),
    ).toBe(true);
  } finally {
    await dispose(box.base);
    await dispose(dir);
  }
});
test("an unrecognised frame type is ignored without a warning", async () => {
  const { box, dir, result } = await run("unknown");
  try {
    expect(result.status).toBe("completed");
    expect(result.warnings).toEqual([]);
  } finally {
    await dispose(box.base);
    await dispose(dir);
  }
});
test("stderr is surfaced as a warning and stays bounded", async () => {
  const { box, dir, result } = await run("stderr");
  try {
    expect(result.status).toBe("completed");
    expect(result.warnings.some((w) => w.includes("stderr"))).toBe(true);
  } finally {
    await dispose(box.base);
    await dispose(dir);
  }
});
test("a missing result frame fails closed", async () => {
  const { box, dir, result } = await run("noresult");
  try {
    expect(result.status).toBe("failed");
    expect(result.warnings.some((w) => w.includes("no result frame"))).toBe(
      true,
    );
  } finally {
    await dispose(box.base);
    await dispose(dir);
  }
});
test("permission denial and max turns surface their mapped outcomes", async () => {
  const denied = await run("error", 4);
  const capped = await run("success", 8);
  try {
    expect(denied.result.status).toBe("failed");
    expect(
      denied.result.warnings.some((w) => w.includes("denied")),
    ).toBe(true);
    expect(capped.result.status).toBe("completed");
    expect(capped.result.truncated).toBe(true);
    expect(
      capped.result.warnings.some((w) => w.includes("max-turns")),
    ).toBe(true);
  } finally {
    await dispose(denied.box.base);
    await dispose(denied.dir);
    await dispose(capped.box.base);
    await dispose(capped.dir);
  }
});
test("cancelling a hung worker terminates its process group", async () => {
  const box = await sandboxWithCommand("hang");
  const dir = await worktree();
  const controller = new AbortController();
  const task = TaskSchema.parse({
    task: "hang",
    role: "implementer",
    repoDir: dir,
    mode: "write_isolated",
  });
  const runtime = new CommandCode(box.config);
  try {
    const started = Date.now();
    setTimeout(() => controller.abort(Error("cancelled by test")), 300);
    const result = await runtime.run(
      task,
      choose("implementer", box.config),
      dir,
      controller.signal,
      async () => {},
    );
    expect(result.status).toBe("cancelled");
    expect(
      result.warnings.some((w) => w.includes("process group")),
    ).toBe(true);
    expect(Date.now() - started).toBeLessThan(15000);
  } finally {
    await dispose(box.base);
    await dispose(dir);
  }
});
test("a worker that writes leaves the change in its own worktree", async () => {
  const { box, dir, result } = await run("write", 0, { mode: "write_isolated" });
  try {
    expect(result.status).toBe("completed");
    expect(await readFile(join(dir, "a.txt"), "utf8")).toBe("changed by worker\n");
  } finally {
    await dispose(box.base);
    await dispose(dir);
  }
});
