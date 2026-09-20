import TOML from "@iarna/toml";
import {
  readFile,
  writeFile,
  mkdir,
  copyFile,
  chmod,
  rename,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { ROOT, paths, preferences } from "./config";
import { mergeGuidance } from "./guidance";
export function mergeTable(
  source: string,
  name: string,
  values: Record<string, string | number | boolean | string[]>,
) {
  TOML.parse(source);
  const lines = source.split("\n");
  const header = `[${name}]`;
  let start = lines.findIndex((l) => l.trim() === header);
  if (start < 0) {
    source = source.trimEnd() + `\n\n${header}\n`;
    return (
      source +
      Object.entries(values)
        .map(([k, v]) => `${k} = ${JSON.stringify(v)}`)
        .join("\n") +
      "\n"
    );
  }
  let end = start + 1;
  while (end < lines.length && !/^\s*\[/.test(lines[end]!)) end++;
  const section = lines.slice(start + 1, end);
  for (const [key, value] of Object.entries(values)) {
    const line = `${key} = ${JSON.stringify(value)}`;
    const i = section.findIndex((l) =>
      new RegExp("^\\s*" + key + "\\s*=").test(l),
    );
    if (i < 0) section.push(line);
    else section[i] = line;
  }
  lines.splice(start + 1, end - start - 1, ...section);
  const result = lines.join("\n");
  TOML.parse(result);
  return result;
}
export async function mergeCodex(
  file: string,
  bun: string,
  root = ROOT,
) {
  return updateFile(file, (original) =>
    mergeTable(original, "mcp_servers.commandcode_workers", {
      command: bun,
      args: ["run", join(root, "src/index.ts")],
      startup_timeout_sec: 60,
      tool_timeout_sec: 3600,
    }),
  );
}
export async function mergeCodexInstructions(home: string) {
  const override = join(home, "AGENTS.override.md");
  const file = (await optionalText(override)).trim()
    ? override
    : join(home, "AGENTS.md");
  return updateFile(file, mergeGuidance);
}
async function optionalText(file: string) {
  try {
    return await readFile(file, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    return "";
  }
}
async function updateFile(file: string, transform: (source: string) => string) {
  const original = await optionalText(file);
  const result = transform(original);
  if (result === original) return { file, changed: false };
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  const backup =
    file +
    ".before-orchestrator-" +
    new Date().toISOString().replace(/[:.]/g, "-");
  if (original) {
    await copyFile(file, backup);
    await chmod(backup, 0o600);
  }
  const tmp = file + ".orchestrator.tmp";
  await writeFile(tmp, result, { mode: 0o600 });
  await rename(tmp, file);
  return { file, changed: true, backup: original ? backup : undefined };
}
export async function install() {
  const bun = Bun.which("bun");
  const codex = Bun.which("codex");
  if (!bun || !codex) throw Error("Codex and Bun must be installed");
  const homes = [
    ...new Set([
      process.env.CODEX_HOME || join(homedir(), ".codex"),
      join(homedir(), ".codex"),
    ]),
  ];
  const changes = [];
  const instructions = [];
  for (const home of homes) {
    changes.push(await mergeCodex(join(home, "config.toml"), bun));
    instructions.push(await mergeCodexInstructions(home));
  }
  const bin = join(homedir(), ".local/bin");
  await mkdir(bin, { recursive: true });
  const doctor = `#!/bin/sh\nexec '${bun}' run '${join(ROOT, "scripts/doctor.ts")}' "$@"\n`;
  await writeFile(join(bin, "codex-commandcode-doctor"), doctor, {
    mode: 0o755,
  });
  await chmod(join(bin, "codex-commandcode-doctor"), 0o755);
  if (!(await Bun.file(paths.config).exists())) {
    await mkdir(dirname(paths.config), { recursive: true, mode: 0o700 });
    await writeFile(
      paths.config,
      JSON.stringify({ routing: preferences, parallelism: 2 }, null, 2) + "\n",
      { mode: 0o600 },
    );
  }
  return {
    changes,
    instructions,
    bin,
    onPath: process.env.PATH?.split(":").includes(bin),
    config: paths.config,
  };
}
