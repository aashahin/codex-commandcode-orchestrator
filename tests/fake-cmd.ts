#!/usr/bin/env bun
// Canned Command Code stand-in. Behaviour is baked into a generated wrapper
// script (tests/helpers.ts) so no global environment is mutated and test files
// stay parallel-safe.
const mode = process.env.FAKE_CMD_MODE ?? "success";
const exit = Number(process.env.FAKE_CMD_EXIT ?? "0");
// Mirror the real CLI so version and model-list probes never trigger worker behaviour.
if (process.argv.includes("--version") || process.argv.includes("-v")) {
  process.stdout.write("fake-cmd 0.0.0\n");
  process.exit(0);
}
if (process.argv.includes("--list-models")) {
  process.stdout.write(
    `Available models  ·  6 models\n\nOpen Source\n\ndeepseek/deepseek-v4-flash             fast hybrid-attention reasoning (default)\ndeepseek/deepseek-v4-flash-vision-exp  fast hybrid-attention reasoning with vision\nmoonshotai/kimi-k2.7-code              improved long-horizon coding with vision\nmoonshotai/kimi-k3                     long-horizon coding & knowledge work\n\nAnthropic\n\nclaude-opus-5                          most intelligent Opus\n\nGoogle\n\nqwen/qwen3.8-max                       autonomous long-horizon coding\n\nDocs:  https://commandcode.ai/docs/reference/cli/models\n`,
  );
  process.exit(0);
}
const out = (value: unknown) => process.stdout.write(JSON.stringify(value) + "\n");
const text = process.env.FAKE_CMD_TEXT ?? "fake summary";
const report = {
  summary: text,
  findings: [
    { kind: "FACT", message: "fake finding", file: "a.txt", severity: "info" },
  ],
  changes: [{ file: "a.txt", reason: "fake change" }],
  tests: [{ command: "bun test", result: "1 pass", passed: true }],
  risks: [],
};
if (mode !== "quiet" && mode !== "noresult") {
  out({
    type: "event",
    event: {
      type: "tool_running",
      toolCallId: "1",
      toolName: "read_file",
      description: "read a.txt",
    },
  });
  out({
    type: "event",
    event: { type: "tool_completed", toolCallId: "1", toolName: "read_file" },
  });
}
if (mode === "unknown")
  out({ type: "telemetry", payload: { forward: "compatible" } });
if (mode === "garbage") process.stdout.write("this line is not json\n");
if (mode === "unknown-event")
  out({ type: "event", event: { type: "brand_new_event", detail: 1 } });
if (mode === "stderr") process.stderr.write("a warning on stderr\n");
if (mode === "hang") await new Promise(() => {});
if (mode === "write") await Bun.write("a.txt", "changed by worker\n");
if (mode === "noresult") process.exit(exit);
if (exit === 8)
  out({
    type: "result",
    subtype: "max_turns",
    sessionId: "sess-fake-0001",
    stopReason: "max_turns",
    usage: { inputTokens: 11, outputTokens: 22 },
    durationMs: 7,
    finalText: JSON.stringify(report),
  });
else if (exit === 0 && mode !== "error")
  out({
    type: "result",
    subtype: "success",
    sessionId: "sess-fake-0001",
    stopReason: "end_turn",
    usage: { inputTokens: 11, outputTokens: 22 },
    durationMs: 7,
    finalText: JSON.stringify(report),
  });
else
  out({
    type: "result",
    subtype: "error",
    sessionId: "sess-fake-0001",
    usage: { inputTokens: 1, outputTokens: 0 },
    durationMs: 3,
    finalText: "",
    error: "fake failure",
  });
process.exit(exit);
export {};
