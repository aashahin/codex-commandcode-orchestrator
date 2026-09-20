import { mkdtemp, writeFile, rm, chmod } from "node:fs/promises";
import { join } from "node:path";
import { git } from "../src/git";
import { ConfigSchema, type Config } from "../src/config";
import type { LiveModel } from "../src/models";
export const config = ConfigSchema.parse({});
const fakeScript = new URL("fake-cmd.ts", import.meta.url).pathname;
export function liveModel(
  id: string,
  efforts: string[],
  vision = false,
): LiveModel {
  return {
    id,
    description: `${id} test entry`,
    shortName: id.slice(id.lastIndexOf("/") + 1),
    free: false,
    efforts,
    vision,
  };
}
// Mirrors the shape parsed from `cmd --list-models`, in the casing cmd reports.
export const models: LiveModel[] = [
  liveModel("deepseek/deepseek-v4-flash", ["high", "max"]),
  liveModel("deepseek/deepseek-v4-flash-vision-exp", ["high", "max"], true),
  liveModel("moonshotai/kimi-k2.7-code", []),
  liveModel("moonshotai/kimi-k3", ["low", "high", "max"]),
  liveModel("qwen/qwen3.8-max", ["low", "medium", "xhigh"]),
  liveModel("gpt-5.6-sol", ["low", "medium", "high", "xhigh", "max"]),
  liveModel("claude-opus-5", ["low", "medium", "high", "xhigh", "max"]),
  liveModel("claude-haiku-4-5-20251001", []),
  liveModel("zai-org/glm-5.3", ["low", "high", "max"]),
  liveModel("poolside/laguna-s-2.1-free", []),
];
export const modelList = { models, source: "cmd --list-models" as const };
export async function fixture() {
  const dir = await mkdtemp("/tmp/cc-bridge-test-");
  await git(dir, ["init", "-q"]);
  await writeFile(join(dir, "a.txt"), "base\n");
  await writeFile(join(dir, "other.txt"), "other\n");
  await git(dir, ["add", "--", "a.txt", "other.txt"]);
  await git(dir, [
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@localhost",
    "commit",
    "-qm",
    "initial",
  ]);
  return dir;
}
export const dispose = (dir: string) =>
  rm(dir, { recursive: true, force: true });
export async function sandbox() {
  const base = await mkdtemp("/tmp/cc-state-");
  return { base, state: join(base, "state"), cache: join(base, "cache") };
}
export async function sandboxWithCommand(
  mode: string,
  exit = 0,
  overrides: Record<string, unknown> = {},
): Promise<{ config: Config; base: string; state: string; cache: string }> {
  const box = await sandbox();
  const command = join(box.base, "fake-cmd");
  await writeFile(
    command,
    `#!/bin/sh\nFAKE_CMD_MODE=${mode} FAKE_CMD_EXIT=${exit} exec ${JSON.stringify(Bun.which("bun") ?? "bun")} ${JSON.stringify(fakeScript)} "$@"\n`,
    { mode: 0o755 },
  );
  await chmod(command, 0o755);
  return {
    ...box,
    config: ConfigSchema.parse({ command, parallelism: 1, ...overrides }),
  };
}
export const task = (repoDir: string, extra: Record<string, unknown> = {}) => ({
  task: "Change a.txt",
  role: "implementer" as const,
  repoDir,
  mode: "write_isolated" as const,
  ...extra,
});
