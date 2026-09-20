import { test, expect } from "bun:test";
import {
  mkdtemp,
  writeFile,
  mkdir,
  readFile,
  stat,
  utimes,
} from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { snapshot } from "../src/worktrees";
import { git } from "../src/git";
import { State, type WorkerRecord } from "../src/state";
import { collect } from "../src/patches";
import { Bridge } from "../src/delegate";
import { CommandCode } from "../src/commandcode";
import {
  config,
  fixture,
  dispose,
  sandboxWithCommand,
  task,
} from "./helpers";
async function setup() {
  const repo = await fixture(),
    base = await mkdtemp("/tmp/cc-recovery-");
  const state = new State(join(base, "state"));
  const cache = join(base, "cache");
  return { repo, base, state, cache };
}
async function worker(f: Awaited<ReturnType<typeof setup>>) {
  const id = randomUUID();
  const s = await snapshot(f.repo, id, config, f.state.dir(id), f.cache);
  const r: WorkerRecord = {
    id,
    role: "implementer",
    model: "deepseek/deepseek-v4-flash",
    status: "failed",
    created: s.created,
    updated: s.created,
    snapshot: s,
    changedFiles: [],
  };
  await f.state.save(r);
  return r;
}
async function bigIgnoredTree(dir: string, name: string, count: number) {
  await mkdir(join(dir, name), { recursive: true });
  for (let i = 0; i < count; i++)
    await writeFile(
      join(dir, name, `chunk-${i}.js`),
      "x".repeat(200) + i,
    );
}
test("an oversized ignored tree degrades to the tracked scope instead of failing", async () => {
  const f = await setup();
  try {
    await writeFile(join(f.repo, ".gitignore"), "dist/\n");
    await git(f.repo, ["add", "--", ".gitignore"]);
    await git(f.repo, [
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@localhost",
      "commit",
      "-qm",
      "ignore dist",
    ]);
    const r = await worker(f);
    await bigIgnoredTree(r.snapshot!.worktree, "dist", 60);
    await writeFile(join(r.snapshot!.worktree, "a.txt"), "source change\n");
    const patch = await collect(r, f.state, {
      ...config,
      maxSnapshotBytes: 2048,
    });
    expect(r.changedFiles).toEqual(["a.txt"]);
    expect(r.artifacts?.count).toBe(60);
    expect(r.artifacts?.sample[0]).toContain("dist/chunk-");
    expect(patch.toString()).toContain("+source change");
    expect(patch.toString()).not.toContain("chunk-");
  } finally {
    await dispose(f.repo);
    await dispose(f.base);
  }
});
test("a normal ignored tree is still collected with no artifacts reported", async () => {
  const f = await setup();
  try {
    await writeFile(join(f.repo, ".gitignore"), "dist/\n");
    await git(f.repo, ["add", "--", ".gitignore"]);
    await git(f.repo, [
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@localhost",
      "commit",
      "-qm",
      "ignore dist",
    ]);
    const r = await worker(f);
    await mkdir(join(r.snapshot!.worktree, "dist"), { recursive: true });
    await writeFile(join(r.snapshot!.worktree, "dist", "small.js"), "built\n");
    const patch = await collect(r, f.state, config);
    expect(r.artifacts).toBeUndefined();
    expect(r.changedFiles).toEqual(["dist/small.js"]);
    expect(patch.toString()).toContain("+built");
  } finally {
    await dispose(f.repo);
    await dispose(f.base);
  }
});
test("a worker that materialised node_modules can still be discarded", async () => {
  const repo = await fixture();
  const box = await sandboxWithCommand("write");
  const bridge = new Bridge(
    box.config,
    new CommandCode(box.config),
    join(box.base, "state"),
    join(box.base, "cache"),
  );
  try {
    const result = await bridge.delegate(task(repo));
    const worktree = result.worktree!;
    // Reproduce the state a pre-fix worker was left in: a huge ignored install
    // tree and a record that had never been collected.
    await bigIgnoredTree(worktree, "node_modules/dep", 400);
    const record = await bridge.state.get(result.id);
    record.collected = undefined;
    await bridge.state.save(record);
    const discarded = (await bridge.discard(result.id)) as {
      status: string;
      warning?: string;
      patchAvailable?: boolean;
    };
    // Collection succeeds despite the install tree, so the patch is preserved
    // rather than the worker being bricked by a snapshot limit.
    expect(discarded.status).toBe("preserved");
    expect(discarded.warning).toBeUndefined();
    expect(discarded.patchAvailable).toBe(true);
    const dropped = (await bridge.discard(result.id, true)) as {
      status: string;
    };
    expect(dropped.status).toBe("discarded");
    expect(await Bun.file(join(worktree, ".git")).exists()).toBe(false);
    expect(
      (await bridge.state.list()).find((w) => w.id === result.id),
    ).toBeUndefined();
  } finally {
    await dispose(repo);
    await dispose(box.base);
  }
});
test("discard never re-collects work that was already collected", async () => {
  const repo = await fixture();
  const box = await sandboxWithCommand("success");
  const bridge = new Bridge(
    box.config,
    new CommandCode(box.config),
    join(box.base, "state"),
    join(box.base, "cache"),
  );
  try {
    const result = await bridge.delegate(task(repo));
    const worktree = result.worktree!;
    expect(result.patchAvailable).toBe(false);
    // Tampering after collection must not resurface as a new patch on teardown.
    await writeFile(join(worktree, "a.txt"), "tampered after collection\n");
    const discarded = (await bridge.discard(result.id)) as { status: string };
    expect(discarded.status).toBe("discarded");
    expect(await Bun.file(join(worktree, ".git")).exists()).toBe(false);
  } finally {
    await dispose(repo);
    await dispose(box.base);
  }
});
test("discard is idempotent for a worker that produced nothing", async () => {
  const repo = await fixture();
  const box = await sandboxWithCommand("error", 10);
  const bridge = new Bridge(
    box.config,
    new CommandCode(box.config),
    join(box.base, "state"),
    join(box.base, "cache"),
  );
  try {
    const result = await bridge.delegate(task(repo));
    expect(result.status).toBe("failed");
    expect(await bridge.discard(result.id)).toMatchObject({
      status: "discarded",
    });
    expect(await bridge.discard(result.id)).toEqual({
      id: result.id,
      status: "discarded",
    });
    const record = await bridge.state.get(result.id);
    expect(record.collected).toBe(true);
  } finally {
    await dispose(repo);
    await dispose(box.base);
  }
});
test("a lock left by a dead process is released on reconcile", async () => {
  const repo = await fixture();
  const box = await sandboxWithCommand("success");
  const bridge = new Bridge(
    box.config,
    new CommandCode(box.config),
    join(box.base, "state"),
    join(box.base, "cache"),
  );
  try {
    const result = await bridge.delegate(task(repo));
    const lock = join(box.state, "locks", "worker-" + result.id);
    await mkdir(lock, { recursive: true });
    const dead = Bun.spawnSync(["true"]).pid;
    await writeFile(
      join(lock, "owner.json"),
      JSON.stringify({ pid: dead, created: new Date().toISOString() }),
    );
    await expect(bridge.discard(result.id)).rejects.toThrow("locked");
    const { released } = await bridge.reconcile();
    expect(released).toContain("worker-" + result.id);
    expect(await bridge.discard(result.id)).toMatchObject({
      status: "discarded",
    });
  } finally {
    await dispose(repo);
    await dispose(box.base);
  }
});
test("a lock held by a live process is left alone", async () => {
  const repo = await fixture();
  const box = await sandboxWithCommand("success");
  const bridge = new Bridge(
    box.config,
    new CommandCode(box.config),
    join(box.base, "state"),
    join(box.base, "cache"),
  );
  try {
    const result = await bridge.delegate(task(repo));
    const lock = join(box.state, "locks", "worker-" + result.id);
    await mkdir(lock, { recursive: true });
    await writeFile(
      join(lock, "owner.json"),
      JSON.stringify({ pid: process.pid, created: new Date().toISOString() }),
    );
    const { released } = await bridge.reconcile();
    expect(released).toEqual([]);
    await expect(bridge.discard(result.id)).rejects.toThrow("locked");
  } finally {
    await dispose(repo);
    await dispose(box.base);
  }
});
test("an ownerless lock is released only once it is old enough", async () => {
  const base = await mkdtemp("/tmp/cc-locks-");
  const state = new State(join(base, "state"));
  try {
    const fresh = join(base, "state", "locks", "worker-fresh");
    await mkdir(fresh, { recursive: true });
    expect(await state.releaseStaleLocks(60000)).toEqual([]);
    const old = join(base, "state", "locks", "worker-old");
    await mkdir(old, { recursive: true });
    const past = Date.now() / 1000 - 600;
    await utimes(old, past, past);
    expect(await state.releaseStaleLocks(60000)).toEqual(["worker-old"]);
    const exists = (path: string) =>
      stat(path).then(
        () => true,
        () => false,
      );
    expect(await exists(old)).toBe(false);
    expect(await exists(fresh)).toBe(true);
  } finally {
    await dispose(base);
  }
});
test("a lock written by this process is never released", async () => {
  const base = await mkdtemp("/tmp/cc-locks-");
  const state = new State(join(base, "state"));
  try {
    await state.lock("worker-self", async () => {
      expect(await state.releaseStaleLocks()).toEqual([]);
    });
    expect(await state.releaseStaleLocks()).toEqual([]);
  } finally {
    await dispose(base);
  }
});
test("an uncollectable worktree is preserved instead of being deleted", async () => {
  const repo = await fixture();
  const box = await sandboxWithCommand("write");
  const bridge = new Bridge(
    box.config,
    new CommandCode(box.config),
    join(box.base, "state"),
    join(box.base, "cache"),
  );
  try {
    const result = await bridge.delegate(task(repo));
    const worktree = result.worktree!;
    await writeFile(join(worktree, "a.txt"), "uncollectable change\n");
    const record = await bridge.state.get(result.id);
    record.collected = undefined;
    await bridge.state.save(record);
    // A config the scan cannot satisfy at all, so collect fails for both scopes.
    const strict = new Bridge(
      { ...box.config, maxFiles: 1 },
      new CommandCode(box.config),
      join(box.base, "state"),
      join(box.base, "cache"),
    );
    const discarded = (await strict.discard(result.id)) as {
      status: string;
      warning?: string;
      worktree?: string;
    };
    expect(discarded.status).toBe("preserved");
    expect(discarded.warning).toContain("could not be collected");
    expect(await readFile(join(worktree, "a.txt"), "utf8")).toBe(
      "uncollectable change\n",
    );
    // The explicit escape hatch still tears it down.
    const dropped = (await strict.discard(result.id, true)) as {
      status: string;
      warning?: string;
    };
    expect(dropped.status).toBe("discarded");
    expect(dropped.warning).toContain("Discarded uncollected changes");
    expect(await Bun.file(join(worktree, ".git")).exists()).toBe(false);
  } finally {
    await dispose(repo);
    await dispose(box.base);
  }
});
