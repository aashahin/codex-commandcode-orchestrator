import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
export const VERSION = "0.1.0";
export const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
export const roles = [
  "explorer",
  "implementer",
  "reviewer",
  "hard_reasoning",
  "vision",
  "cheap",
] as const;
export type Role = (typeof roles)[number];
export const efforts = ["low", "medium", "high", "xhigh", "max"] as const;
export type Effort = (typeof efforts)[number];
// Go-and-above floor only, so nothing is plan-gated out of the box. Override in config.json.
export const preferences: Record<Role, string[]> = {
  explorer: ["deepseek/deepseek-v4-flash"],
  implementer: ["moonshotai/Kimi-K2.7-Code"],
  reviewer: ["Qwen/Qwen3.8-Max"],
  hard_reasoning: ["moonshotai/Kimi-K3"],
  vision: ["deepseek/deepseek-v4-flash-vision-exp"],
  cheap: ["deepseek/deepseek-v4-flash"],
};
export const ConfigSchema = z
  .object({
    routing: z
      .object(
        Object.fromEntries(
          roles.map((r) => [
            r,
            z.array(z.string().min(1).max(200)).max(20).optional(),
          ]),
        ) as Record<Role, z.ZodOptional<z.ZodArray<z.ZodString>>>,
      )
      .strict()
      .default({}),
    parallelism: z.number().int().min(1).max(8).default(2),
    timeoutSeconds: z.number().int().min(1).max(1800).default(900),
    maxTurns: z.number().int().min(1).max(1000).default(100),
    maxEvents: z.number().int().min(0).max(10000).default(500),
    maxFiles: z.number().int().min(1).max(100000).default(30000),
    maxSnapshotBytes: z
      .number()
      .int()
      .min(1024)
      .max(1024 ** 3)
      .default(256 * 1024 ** 2),
    maxPatchBytes: z
      .number()
      .int()
      .min(1024)
      .max(64 * 1024 ** 2)
      .default(16 * 1024 ** 2),
    maxOutputBytes: z
      .number()
      .int()
      .min(1024)
      .max(256 * 1024)
      .default(48000),
    command: z
      .string()
      .min(1)
      .max(4096)
      .optional()
      .describe("Override the Command Code binary. Defaults to cmd on PATH."),
    extraArgs: z
      .array(z.string().max(4096))
      .max(40)
      .default([])
      .describe("Extra arguments appended to every worker invocation."),
    toolsEnable: z
      .array(z.string().min(1).max(200))
      .max(20)
      .default([])
      .describe("Headless-withheld tools to re-enable for workers, for example todo_write."),
    guardrails: z
      .boolean()
      .default(true)
      .describe("Install the worktree deny-list overlay before each worker run."),
  })
  .strict();
export type Config = z.infer<typeof ConfigSchema>;
export const paths = {
  config: join(
    process.env.XDG_CONFIG_HOME || join(homedir(), ".config"),
    "codex-commandcode-orchestrator",
    "config.json",
  ),
  state: join(
    process.env.XDG_STATE_HOME || join(homedir(), ".local/state"),
    "codex-commandcode-orchestrator",
  ),
  cache: join(
    process.env.XDG_CACHE_HOME || join(homedir(), ".cache"),
    "codex-commandcode-orchestrator",
  ),
};
export async function loadConfig(
  file = process.env.CC_BRIDGE_CONFIG || paths.config,
): Promise<Config> {
  const f = Bun.file(file);
  return ConfigSchema.parse((await f.exists()) ? await f.json() : {});
}
export function commandBinary(config: Config) {
  return (
    config.command ??
    process.env.CC_BRIDGE_COMMAND ??
    Bun.which("cmd") ??
    Bun.which("command-code") ??
    "cmd"
  );
}
export const TaskSchema = z
  .object({
    task: z.string().min(1).max(24000),
    role: z.enum(roles).default("explorer"),
    model: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe(
        "Exact Command Code model id from cc_models, optionally with a :effort suffix. Any BYOK provider id is also accepted and passed through as-is.",
      ),
    effort: z
      .enum(efforts)
      .optional()
      .describe(
        "Reasoning effort. Must be advertised by the catalog entry; if the model already carries a :effort suffix the two must agree.",
      ),
    repoDir: z.string().min(2).max(4096),
    mode: z.enum(["read_only", "write_isolated"]).default("read_only"),
    scope: z.array(z.string().min(1).max(1024)).max(100).default([]),
    constraints: z.array(z.string().max(2000)).max(30).default([]),
    verification: z.array(z.string().max(1000)).max(20).default([]),
    timeoutSeconds: z.number().int().min(1).max(1800).optional(),
    maxTurns: z.number().int().min(1).max(1000).optional(),
  })
  .strict();
export type Task = z.infer<typeof TaskSchema>;
