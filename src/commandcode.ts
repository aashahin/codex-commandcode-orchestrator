import { commandBinary, VERSION, type Config, type Task } from "./config";
import { command } from "./git";
import { ModelCatalog, type ModelList } from "./models";
import { contract } from "./prompts";
import type { Model } from "./router";
import { errorText } from "./security";
import type { WorkerStatus } from "./state";
export interface ResultFrame {
  type: "result";
  subtype?: string;
  sessionId?: string;
  stopReason?: string;
  usage?: unknown;
  durationMs?: number;
  finalText?: string;
  error?: string;
}
export interface RuntimeResult {
  text: string;
  status: WorkerStatus;
  sessionID?: string;
  stopReason?: string;
  truncated: boolean;
  usage?: unknown;
  durationMs?: number;
  exitCode?: number;
  tools: Array<{ name: string; description?: string }>;
  warnings: string[];
}
export interface RuntimeHealth {
  binary: string;
  version?: string;
  error?: string;
  bridge: string;
}
export interface Runtime {
  models(signal?: AbortSignal): Promise<ModelList>;
  run(
    task: Task,
    model: Model,
    worktree: string,
    signal: AbortSignal,
    onSession: (id: string) => Promise<void>,
  ): Promise<RuntimeResult>;
  health(): Promise<RuntimeHealth>;
}
const maxLine = 1024 * 1024;
const maxWarnings = 20;
const maxTools = 200;
const maxStderr = 8192;
export const exitCodes: Record<
  number,
  { status: WorkerStatus; message?: string; truncated?: boolean }
> = {
  0: { status: "completed" },
  1: { status: "failed", message: "Command Code reported a general error" },
  3: {
    status: "failed",
    message:
      "Command Code is not authenticated. Run cmd once interactively and sign in.",
  },
  4: {
    status: "failed",
    message: "A tool call was denied by Command Code permissions",
  },
  5: { status: "failed", message: "Command Code rate limit exceeded" },
  6: { status: "failed", message: "Command Code network failure" },
  7: { status: "failed", message: "Command Code API server error" },
  8: {
    status: "completed",
    message: "Partial result: the worker hit its max-turns cap",
    truncated: true,
  },
  9: { status: "failed", message: "The model produced no response" },
  10: { status: "failed", message: "Insufficient Command Code credits" },
  130: { status: "cancelled", message: "Command Code was interrupted" },
};
export function workerArgs(
  task: Task,
  model: Model,
  worktree: string,
  config: Config,
) {
  const args = [
    "-p",
    contract(task, worktree),
    "--output-format",
    "json",
    "--max-turns",
    String(task.maxTurns ?? config.maxTurns),
    "--model",
    model.id,
  ];
  // cmd rejects "id:effort" as an unknown model, so effort travels as its own flag.
  if (model.effort) args.push("--effort", model.effort);
  args.push("--trust", "--skip-onboarding");
  if (task.mode === "read_only") args.push("--permission-mode", "plan");
  else args.push("--yolo");
  if (config.toolsEnable.length)
    args.push("--tools-enable", config.toolsEnable.join(","));
  args.push(...config.extraArgs);
  return args;
}
export function preflight(stderr: string) {
  const unknown = /unknown model "([^"]+)"/i.exec(stderr);
  if (unknown)
    return `Command Code rejected the model "${unknown[1]}". Call cc_models for the live id list from cmd --list-models.`;
  if (/has no adjustable reasoning effort/i.test(stderr))
    return "The selected model has no adjustable reasoning effort; drop effort or choose a model that advertises one (see cc_models).";
  return undefined;
}
// cmd prints flag confirmations to stderr to keep stdout pipeable; those are not problems.
const informational = /^(Reasoning effort set to|Model set to|Config set)\b/i;
export function stderrNoise(stderr: string) {
  return stderr
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !informational.test(line))
    .join(" ");
}
function signalGroup(child: Bun.Subprocess<"ignore", "pipe", "pipe">, signal: NodeJS.Signals) {
  try {
    process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {}
  }
}
async function readLines(
  stream: ReadableStream<Uint8Array>,
  onLine: (line: string) => void,
) {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of stream) {
    buffer += decoder.decode(chunk, { stream: true });
    let index = buffer.indexOf("\n");
    while (index >= 0) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      if (line.trim()) onLine(line);
      index = buffer.indexOf("\n");
    }
    if (buffer.length > maxLine) buffer = "";
  }
  buffer += decoder.decode();
  if (buffer.trim()) onLine(buffer);
}
async function readBounded(stream: ReadableStream<Uint8Array>, max: number) {
  const chunks: Uint8Array[] = [];
  let length = 0;
  for await (const chunk of stream) {
    if (length >= max) continue;
    chunks.push(chunk.subarray(0, max - length));
    length += chunk.length;
  }
  return Buffer.concat(chunks).toString("utf8");
}
export class CommandCode implements Runtime {
  private readonly catalog: ModelCatalog;
  constructor(readonly config: Config) {
    this.catalog = new ModelCatalog(config);
  }
  models(signal?: AbortSignal) {
    return this.catalog.list(signal);
  }
  async run(
    task: Task,
    model: Model,
    worktree: string,
    signal: AbortSignal,
    onSession: (id: string) => Promise<void>,
  ): Promise<RuntimeResult> {
    signal.throwIfAborted();
    const config = this.config;
    const binary = commandBinary(config);
    const warnings: string[] = [];
    const tools: Array<{ name: string; description?: string }> = [];
    const events: unknown[] = [];
    let result: ResultFrame | undefined;
    let seen = 0;
    let stop: "timeout" | "cancel" | undefined;
    const warn = (message: string) => {
      if (warnings.length < maxWarnings) warnings.push(message);
    };
    const handleLine = (line: string) => {
      seen += line.length;
      let frame: unknown;
      try {
        frame = JSON.parse(line);
      } catch {
        warn("Ignored an output line that was not valid JSON");
        return;
      }
      if (!frame || typeof frame !== "object") return;
      const kind = (frame as { type?: unknown }).type;
      if (kind === "result") {
        result = frame as ResultFrame;
        return;
      }
      // Unknown frame types are forward compatible and ignored.
      if (kind !== "event") return;
      if (seen > config.maxOutputBytes * 8) return;
      const event = (frame as { event?: unknown }).event;
      if (event && typeof event === "object") {
        const { toolName, description } = event as {
          toolName?: unknown;
          description?: unknown;
        };
        if (typeof toolName === "string" && tools.length < maxTools)
          tools.push({
            name: toolName,
            description:
              typeof description === "string"
                ? description.slice(0, 240)
                : undefined,
          });
      }
      events.push(frame);
      if (events.length > config.maxEvents)
        events.splice(0, events.length - config.maxEvents);
    };
    const env = { ...process.env };
    for (const key of Object.keys(env)) if (key.startsWith("GIT_")) delete env[key];
    const child = Bun.spawn([binary, ...workerArgs(task, model, worktree, config)], {
      cwd: worktree,
      env,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      detached: true,
    });
    let escalation: ReturnType<typeof setTimeout> | undefined;
    const terminate = () => {
      signalGroup(child, "SIGTERM");
      escalation = setTimeout(() => signalGroup(child, "SIGKILL"), 5000);
    };
    const onAbort = () => {
      stop =
        (signal.reason as { name?: string } | undefined)?.name === "TimeoutError"
          ? "timeout"
          : "cancel";
      warn(
        stop === "timeout"
          ? "Worker exceeded its timeout and its process group was terminated"
          : "Worker was cancelled and its process group was terminated",
      );
      terminate();
    };
    signal.addEventListener("abort", onAbort, { once: true });
    let exitCode: number | undefined;
    let stderr = "";
    try {
      const [, , code] = await Promise.all([
        readLines(child.stdout, handleLine),
        readBounded(child.stderr, maxStderr).then((value) => {
          stderr = value;
        }),
        child.exited,
      ]);
      exitCode = code;
    } finally {
      clearTimeout(escalation);
      signal.removeEventListener("abort", onAbort);
    }
    const text = typeof result?.finalText === "string" ? result.finalText : "";
    const outcome = classify(exitCode, result, stop);
    const rejection = preflight(stderr);
    if (rejection && !stop) warn(rejection);
    else if (outcome.message) warn(outcome.message);
    if (result?.subtype === "error" && result.error)
      warn(errorText(result.error));
    if (!result && !stop && !rejection)
      warn(
        "Command Code emitted no result frame; the run cannot be validated",
      );
    const noise = stderrNoise(stderr);
    if (noise && !rejection && !stop)
      warn(`stderr: ${noise.slice(0, 600)}`);
    if (result?.sessionId) await onSession(result.sessionId);
    return {
      text,
      status: result || stop ? outcome.status : "failed",
      sessionID: result?.sessionId,
      stopReason: result?.stopReason,
      truncated: outcome.truncated,
      usage: result?.usage,
      durationMs: result?.durationMs,
      exitCode,
      tools,
      warnings,
    };
  }
  async health() {
    const binary = commandBinary(this.config);
    let version: string | undefined;
    let error: string | undefined;
    try {
      version =
        (await command([binary, "--version"], { max: 4096 }))
          .toString()
          .trim()
          .split("\n")[0] ?? undefined;
    } catch (e) {
      error = errorText(e);
    }
    return {
      binary,
      version,
      error,
      bridge: VERSION,
    };
  }
}
export function classify(
  exitCode: number | undefined,
  result: ResultFrame | undefined,
  stop: "timeout" | "cancel" | undefined,
) {
  if (stop === "timeout")
    return { status: "timed_out" as WorkerStatus, truncated: false };
  if (stop === "cancel")
    return { status: "cancelled" as WorkerStatus, truncated: false };
  const mapped = exitCodes[exitCode ?? -1];
  if (!mapped)
    return {
      status: "failed" as WorkerStatus,
      message: `Command Code exited with code ${exitCode ?? "unknown"}`,
      truncated: false,
    };
  if (result?.subtype === "error")
    return {
      status: "failed" as WorkerStatus,
      message: mapped.message,
      truncated: false,
    };
  return {
    status: mapped.status,
    message: mapped.message,
    truncated:
      (mapped.truncated ?? false) || result?.stopReason === "max_turns",
  };
}
