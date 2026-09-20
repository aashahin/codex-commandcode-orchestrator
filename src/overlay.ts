import { mkdir, rename, rm, lstat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Task } from "./config";
export const overlayPaths = [".commandcode", ".mcp.json"];
// Deny rules are enforced even under --yolo, so these hold while bypass covers the rest.
export const guardrails = [
  "Edit(.git)",
  "Edit(.git/**)",
  "Write(.git/**)",
  "Edit(~/.commandcode/**)",
  "Edit(~/.codex/**)",
  "Edit(~/.ssh/**)",
  "Edit(~/.aws/**)",
  "Edit(~/.gnupg/**)",
  "Shell(git push:*)",
  "Shell(git remote add:*)",
  "Shell(git remote set-url:*)",
  "Shell(git worktree:*)",
  "Shell(git reset --hard:*)",
  "Shell(git clean:*)",
  "Shell(git update-ref:*)",
  "Shell(sudo:*)",
];
export function settings(task: Task) {
  return { permissions: { defaultMode: "default", deny: guardrails } };
}
export async function installOverlay(worktree: string, state: string, task: Task) {
  const backup = join(state, "overlay");
  await mkdir(backup, { recursive: true, mode: 0o700 });
  const saved: string[] = [];
  for (const file of overlayPaths) {
    try {
      await lstat(join(worktree, file));
      await rename(join(worktree, file), join(backup, file));
      saved.push(file);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
  }
  await writeFile(join(state, "overlay.json"), JSON.stringify(saved), {
    mode: 0o600,
  });
  await mkdir(join(worktree, ".commandcode"), { recursive: true });
  await writeFile(
    join(worktree, ".commandcode", "settings.json"),
    JSON.stringify(settings(task), null, 2) + "\n",
    { mode: 0o600 },
  );
}
export async function restoreOverlay(worktree: string, state: string) {
  const marker = Bun.file(join(state, "overlay.json"));
  if (!(await marker.exists())) return;
  const saved = (await marker.json()) as string[];
  for (const file of overlayPaths)
    await rm(join(worktree, file), { recursive: true, force: true });
  for (const file of saved) {
    if (!overlayPaths.includes(file)) throw Error("Invalid overlay");
    await rename(join(state, "overlay", file), join(worktree, file));
  }
  await rm(join(state, "overlay"), { recursive: true, force: true });
  await rm(join(state, "overlay.json"), { force: true });
}
