import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdtemp, mkdir, writeFile, chmod, rm } from "node:fs/promises";
import { join } from "node:path";
import { git } from "../src/git";
import { ROOT } from "../src/config";
const fake = process.argv.includes("--fake");
const apply = process.argv.includes("--apply");
const bun = Bun.which("bun") ?? "bun";
const base = await mkdtemp("/tmp/cc-smoke-");
const repo = join(base, "repo");
const source = `export function total(items) {
  let sum = 0;
  for (const item of items) sum += item.price;
  return sum;
}

export function discounted(items, rate) {
  return total(items) * (1 - rate);
}
`;
async function environment() {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([, value]) => value !== undefined),
  ) as Record<string, string>;
  env.CC_BRIDGE_CONFIG = join(base, "config.json");
  // Keep throwaway worker state and worktrees inside the smoke sandbox. HOME is left
  // alone so cmd keeps its own credentials.
  env.XDG_STATE_HOME = join(base, "state");
  env.XDG_CACHE_HOME = join(base, "cache");
  if (!fake) return env;
  const wrapper = join(base, "fake-cmd");
  await writeFile(
    wrapper,
    `#!/bin/sh\nFAKE_CMD_MODE=write exec ${JSON.stringify(bun)} ${JSON.stringify(join(ROOT, "tests/fake-cmd.ts"))} "$@"\n`,
    { mode: 0o755 },
  );
  await chmod(wrapper, 0o755);
  env.CC_BRIDGE_COMMAND = wrapper;
  return env;
}
await mkdir(repo, { recursive: true });
await git(repo, ["init", "-q"]);
await writeFile(join(repo, "cart.mjs"), source);
await writeFile(join(repo, "a.txt"), "base\n");
await git(repo, ["add", "--", "cart.mjs", "a.txt"]);
await git(repo, [
  "-c",
  "user.name=Smoke",
  "-c",
  "user.email=smoke@localhost",
  "commit",
  "-qm",
  "initial",
]);
const transport = new StdioClientTransport({
  command: bun,
  args: ["run", join(ROOT, "src/index.ts")],
  cwd: ROOT,
  env: await environment(),
  stderr: "inherit",
});
const client = new Client({ name: "smoke", version: "0.0.0" });
const call = async (
  name: string,
  args?: Record<string, unknown>,
  timeout = 60000,
) =>
  (
    (await (args
      ? client.callTool({ name, arguments: args }, undefined, { timeout })
      : client.callTool({ name }, undefined, { timeout }))) as {
      structuredContent?: Record<string, unknown>;
      content: Array<{ text: string }>;
    }
  ).structuredContent;
await client.connect(transport);
const tools = await client.listTools();
console.log(
  `connected: ${tools.tools.length} tools (${tools.tools.map((t) => t.name).join(", ")})`,
);
const health = (await call("cc_health")) as {
  runtime: { binary: string; version?: string };
  routing: Record<string, string>;
};
console.log("command:", health.runtime.binary, health.runtime.version ?? "");
console.log("routing:", JSON.stringify(health.routing));
if (fake) console.log("\n--fake: bytes are written by a stub, no credits are spent");
else console.log("\nLIVE: this run spends Command Code credits");
const task = fake
  ? {
      task: "Exercise the bridge end to end.",
      role: "implementer",
      repoDir: repo,
      mode: "write_isolated",
    }
  : {
      task: "Review cart.mjs. Identify the correctness bug in discounted() when rate is a percentage rather than a fraction, and report it as a finding. Make no edits.",
      role: "reviewer",
      repoDir: repo,
      mode: "read_only",
      verification: ["node --check cart.mjs"],
    };
const result = (await call("cc_delegate", task, 900000)) as {
  id: string;
  status: string;
  model: string;
  modelVerified: boolean;
  summary: string;
  findings: unknown[];
  changedFiles: string[];
  usage?: unknown;
  durationMs?: number;
  warnings: string[];
  patchId?: string;
};
console.log(
  `\ndelegate: status=${result.status} model=${result.model} verified=${result.modelVerified} durationMs=${result.durationMs ?? "-"}`,
);
console.log(`usage: ${JSON.stringify(result.usage)}`);
console.log(`summary: ${result.summary}`);
console.log(`findings: ${result.findings.length}  changedFiles: ${JSON.stringify(result.changedFiles)}`);
if (result.warnings.length) console.log(`warnings: ${result.warnings.join(" | ")}`);
if (apply && result.patchId) {
  const diff = (await call("cc_worker_diff", {
    id: result.id,
    offset: 0,
    limit: 48000,
  })) as { reviewToken?: string; patch: string };
  console.log(`\npatch (${result.id}):\n${diff.patch}`);
  if (diff.reviewToken) {
    const applied = await call("cc_apply_worker_patch", {
      id: result.id,
      repoDir: repo,
      reviewToken: diff.reviewToken,
    });
    console.log(`applied: ${JSON.stringify(applied)}`);
  }
}
console.log(`\nworkers: ${JSON.stringify(await call("cc_list_workers"))}`);
const failed = result.status !== "completed";
if (failed) console.error(`\nsmoke failed: ${result.status}`);
const discarded = await call("cc_discard_worker", {
  id: result.id,
  discardPatch: true,
});
console.log(`cleanup: ${JSON.stringify(discarded)}`);
await client.close();
await rm(base, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
