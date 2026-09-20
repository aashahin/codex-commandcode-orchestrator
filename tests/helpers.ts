import { mkdtemp, writeFile, rm, chmod } from "node:fs/promises";
import { join } from "node:path";
import { git } from "../src/git";
import { ConfigSchema, type Config } from "../src/config";
export const config = ConfigSchema.parse({});
const fakeScript = new URL("fake-cmd.ts", import.meta.url).pathname;
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
