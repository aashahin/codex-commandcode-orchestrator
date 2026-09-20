import { test, expect } from "bun:test";
import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import TOML from "@iarna/toml";
import { mergeTable, mergeCodex, mergeCodexInstructions } from "../src/install";
import { mergeGuidance } from "../src/guidance";
const opencodeBegin = "<!-- codex-opencode-orchestrator:begin -->";
const opencodeEnd = "<!-- codex-opencode-orchestrator:end -->";
test("a new MCP server section is appended without touching existing config", () => {
  const source = `# my codex config\nmodel = "gpt-6-astra"\n\n[mcp_servers.opencode_workers]\ncommand = "/bun"\nargs = ["run","oc.ts"]\n`;
  const merged = mergeTable(source, "mcp_servers.commandcode_workers", {
    command: "/bun",
    args: ["run", "/bridge/src/index.ts"],
    startup_timeout_sec: 60,
    tool_timeout_sec: 3600,
  });
  expect(merged).toContain("# my codex config");
  expect(merged).toContain('model = "gpt-6-astra"');
  expect(merged).toContain("[mcp_servers.opencode_workers]");
  expect(merged).toContain("[mcp_servers.commandcode_workers]");
  const parsed = TOML.parse(merged) as {
    mcp_servers: Record<string, Record<string, unknown>>;
  };
  expect(parsed.mcp_servers.commandcode_workers).toEqual({
    command: "/bun",
    args: ["run", "/bridge/src/index.ts"],
    startup_timeout_sec: 60,
    tool_timeout_sec: 3600,
  });
  expect(parsed.mcp_servers.opencode_workers.command).toBe("/bun");
});
test("merging the same section twice is idempotent", async () => {
  const dir = await mkdtemp("/tmp/cc-install-");
  const file = join(dir, "config.toml");
  await writeFile(file, 'model = "gpt-6-astra"\n');
  const first = await mergeCodex(file, "/bun", "/root");
  expect(first.changed).toBe(true);
  const once = await readFile(file, "utf8");
  const second = await mergeCodex(file, "/bun", "/root");
  expect(second.changed).toBe(false);
  expect(await readFile(file, "utf8")).toBe(once);
  expect(once).toContain('args = ["run","/root/src/index.ts"]');
});
test("a modified file is backed up before being replaced", async () => {
  const dir = await mkdtemp("/tmp/cc-install-");
  const file = join(dir, "config.toml");
  await writeFile(file, 'model = "x"\n');
  const result = await mergeCodex(file, "/bun", "/root");
  expect(result.backup).toBeDefined();
  expect(await readFile(result.backup!, "utf8")).toBe('model = "x"\n');
});
test("instructions merge is idempotent and preserves user content", async () => {
  const dir = await mkdtemp("/tmp/cc-install-");
  await writeFile(join(dir, "AGENTS.md"), "# Personal rules\n\nBe careful.\n");
  const first = await mergeCodexInstructions(dir);
  expect(first.changed).toBe(true);
  const content = await readFile(join(dir, "AGENTS.md"), "utf8");
  expect(content).toContain("# Personal rules");
  expect(content).toContain("<!-- codex-commandcode-orchestrator:begin -->");
  expect(content).toContain("commandcode_workers");
  const second = await mergeCodexInstructions(dir);
  expect(second.changed).toBe(false);
  expect(await readFile(join(dir, "AGENTS.md"), "utf8")).toBe(content);
});
test("a non-empty AGENTS.override.md takes precedence", async () => {
  const dir = await mkdtemp("/tmp/cc-install-");
  await writeFile(join(dir, "AGENTS.md"), "# base\n");
  await writeFile(join(dir, "AGENTS.override.md"), "# override\n");
  const result = await mergeCodexInstructions(dir);
  expect(result.file).toBe(join(dir, "AGENTS.override.md"));
  expect(await readFile(join(dir, "AGENTS.md"), "utf8")).toBe("# base\n");
});
test("the command code guidance block coexists with the opencode block", () => {
  const source = `# Personal Codex workflow\n\n${opencodeBegin}\n## OpenCode worker delegation and recovery\n\nUse oc_delegate.\n${opencodeEnd}\n`;
  const merged = mergeGuidance(source);
  expect(merged).toContain(opencodeBegin);
  expect(merged).toContain("Use oc_delegate.");
  expect(merged).toContain("<!-- codex-commandcode-orchestrator:begin -->");
  expect(merged).toContain("cc_delegate");
  const parsed = TOML.parse("a = 1");
  expect(parsed.a).toBe(1);
  expect(merged.indexOf(opencodeBegin)).toBeLessThan(
    merged.indexOf("<!-- codex-commandcode-orchestrator:begin -->"),
  );
});
test("re-merging guidance repairs the block instead of duplicating it", () => {
  const source = `${opencodeBegin}\noc\n${opencodeEnd}\n`;
  const once = mergeGuidance(source);
  const twice = mergeGuidance(once);
  expect(twice).toBe(once);
  expect(twice.split("<!-- codex-commandcode-orchestrator:begin -->")).toHaveLength(
    2,
  );
});
test("malformed markers are refused rather than silently rewritten", () => {
  expect(() =>
    mergeGuidance("<!-- codex-commandcode-orchestrator:begin -->\nno end\n"),
  ).toThrow("Malformed");
});
test("guidance namespaces the two bridges by model id", async () => {
  const dir = await mkdtemp("/tmp/cc-install-");
  await mkdir(join(dir, "nested"));
  await mergeCodexInstructions(dir);
  const content = await readFile(join(dir, "AGENTS.md"), "utf8");
  expect(content).toContain("opencode-go/");
  expect(content).toContain("commandcode_workers");
  expect(content).toContain("Never run cmd -p");
});
