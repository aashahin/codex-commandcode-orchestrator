import { test, expect } from "bun:test";
import { mkdtemp, readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { installOverlay, restoreOverlay, guardrails, settings } from "../src/overlay";
import { TaskSchema } from "../src/config";
import { dispose } from "./helpers";
const readOnly = TaskSchema.parse({ task: "x", repoDir: "/tmp", mode: "read_only" });
async function pair() {
  const base = await mkdtemp("/tmp/cc-overlay-");
  const worktree = join(base, "worktree");
  const state = join(base, "state");
  await mkdir(worktree, { recursive: true });
  return { base, worktree, state };
}
test("the guardrail deny list protects refs, git dirs and global state", () => {
  expect(guardrails).toContain("Shell(git push:*)");
  expect(guardrails).toContain("Shell(git worktree:*)");
  expect(guardrails.some((rule) => rule.startsWith("Edit(.git"))).toBe(true);
  expect(guardrails).toContain("Edit(~/.commandcode/**)");
  expect(guardrails).toContain("Edit(~/.codex/**)");
  expect(settings(readOnly).permissions.deny).toEqual(guardrails);
});
test("an existing project settings file and mcp config are restored byte for byte", async () => {
  const { base, worktree, state } = await pair();
  try {
    await mkdir(join(worktree, ".commandcode"), { recursive: true });
    await writeFile(join(worktree, ".commandcode", "settings.json"), '{"a":1}\n');
    await writeFile(join(worktree, ".commandcode", "other.json"), '{"b":2}\n');
    await writeFile(join(worktree, ".mcp.json"), '{"mcpServers":{}}\n');
    await installOverlay(worktree, state, readOnly);
    const installed = JSON.parse(
      await readFile(join(worktree, ".commandcode", "settings.json"), "utf8"),
    );
    expect(installed.permissions.deny).toEqual(guardrails);
    expect(await Bun.file(join(worktree, ".mcp.json")).exists()).toBe(false);
    expect(
      await Bun.file(join(worktree, ".commandcode", "other.json")).exists(),
    ).toBe(false);
    await restoreOverlay(worktree, state);
    expect(
      await readFile(join(worktree, ".commandcode", "settings.json"), "utf8"),
    ).toBe('{"a":1}\n');
    expect(
      await readFile(join(worktree, ".commandcode", "other.json"), "utf8"),
    ).toBe('{"b":2}\n');
    expect(await readFile(join(worktree, ".mcp.json"), "utf8")).toBe(
      '{"mcpServers":{}}\n',
    );
  } finally {
    await dispose(base);
  }
});
test("restoring an overlay that was never installed is a no-op", async () => {
  const { base, worktree, state } = await pair();
  try {
    await restoreOverlay(worktree, state);
    await restoreOverlay(worktree, state);
    expect(await Bun.file(join(worktree, ".commandcode")).exists()).toBe(false);
  } finally {
    await dispose(base);
  }
});
test("a leftover project overlay directory is fully removed on restore", async () => {
  const { base, worktree, state } = await pair();
  try {
    await installOverlay(worktree, state, readOnly);
    await writeFile(join(worktree, ".commandcode", "leftover.json"), "{}");
    await restoreOverlay(worktree, state);
    expect(await Bun.file(join(worktree, ".commandcode")).exists()).toBe(false);
    expect(await Bun.file(join(state, "overlay.json")).exists()).toBe(false);
    await rm(join(state, "overlay"), { recursive: true, force: true });
  } finally {
    await dispose(base);
  }
});
