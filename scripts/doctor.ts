import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import TOML from "@iarna/toml";
import { loadConfig, commandBinary } from "../src/config";
import { Bridge } from "../src/delegate";
const config = await loadConfig();
const bridge = new Bridge(config);
const reconciled = await bridge.reconcile();
const file = join(
  process.env.CODEX_HOME || join(homedir(), ".codex"),
  "config.toml",
);
let registered: unknown;
try {
  const parsed = TOML.parse(await readFile(file, "utf8")) as {
    mcp_servers?: Record<string, unknown>;
  };
  registered = parsed.mcp_servers?.commandcode_workers ?? "not registered";
} catch (e) {
  registered = e instanceof Error ? e.message : String(e);
}
console.log(
  JSON.stringify(
    {
      health: await bridge.health(),
      codex: { config: file, mcpServer: registered },
      command: { resolved: commandBinary(config), config: config.command },
      reconciled,
      workers: await bridge.state.list(true),
    },
    null,
    2,
  ),
);
await bridge.close();
