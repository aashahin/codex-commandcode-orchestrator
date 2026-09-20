import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { Bridge } from "./delegate";
import { VERSION, TaskSchema } from "./config";
import { errorText, redact } from "./security";
import { WORKFLOW_GUIDANCE, RECOVERY_GUIDANCE } from "./guidance";
const Id = z.string().uuid();
export function createMcp(bridge: Bridge) {
  const server = new McpServer(
    { name: "commandcode-worker-bridge", version: VERSION },
    { instructions: WORKFLOW_GUIDANCE },
  );
  const respond = async (fn: () => Promise<unknown>) => {
    try {
      const value = await fn();
      const serialized = redact(JSON.stringify(value), 512000);
      let output;
      try {
        output = JSON.parse(serialized);
      } catch {
        output = {
          error:
            "Result exceeded output bound; use worker diff pagination or a narrower task.",
        };
      }
      return {
        content: [{ type: "text" as const, text: JSON.stringify(output) }],
        structuredContent: output,
      };
    } catch (e) {
      return {
        isError: true,
        content: [
          { type: "text" as const, text: `${errorText(e)}\n${RECOVERY_GUIDANCE}` },
        ],
      };
    }
  };
  server.registerTool(
    "cc_health",
    {
      description:
        "Check the Command Code CLI, bridge health, worker counts and current model routing. Authentication is not inspected; a run that is not signed in fails with exit code 3.",
    },
    () => respond(() => bridge.health()),
  );
  server.registerTool(
    "cc_models",
    {
      description:
        "Discover Command Code model ids, per-model context, advertised reasoning efforts and minimum plan, plus role routing. Ids are exact and efforts are model-specific; inspect both before requesting an effort. Any BYOK provider id is also accepted.",
    },
    () => respond(() => bridge.models()),
  );
  server.registerTool(
    "cc_delegate",
    {
      description:
        "Required path for Command Code work, including follow-up fixes after compaction or errors. Never substitute cmd -p or any direct CLI invocation. Snapshots the repository into an isolated Git worktree; writes require write_isolated; explorers and reviewers must be read_only. Nothing is integrated automatically. Select the model and effort from cc_models, and recover existing work with cc_list_workers first.",
      inputSchema: TaskSchema,
    },
    (args, extra) => respond(() => bridge.delegate(args, extra.signal)),
  );
  server.registerTool(
    "cc_delegate_parallel",
    {
      description:
        "Run independent Command Code workers through the MCP bridge in concurrent isolated worktrees, with individual failures and timeouts. Use this instead of parallel CLI processes; recover existing work with cc_list_workers first. Each worker consumes credits.",
      inputSchema: {
        tasks: z.array(TaskSchema).min(1).max(16),
        concurrency: z.number().int().min(1).max(8).optional(),
      },
    },
    (args, extra) =>
      respond(() =>
        bridge.delegateParallel(args.tasks, args.concurrency, extra.signal),
      ),
  );
  server.registerTool(
    "cc_worker_diff",
    {
      description:
        "Inspect a paginated worker patch. Read all bytes to receive the reviewToken required for explicit application.",
      inputSchema: {
        id: Id,
        offset: z.number().int().min(0).default(0),
        limit: z.number().int().min(256).max(48000).default(20000),
      },
    },
    (a) => respond(() => bridge.diff(a.id, a.offset, a.limit)),
  );
  server.registerTool(
    "cc_apply_worker_patch",
    {
      description:
        "Explicitly apply a fully inspected patch to the user's repository. Rejects changed HEAD, repository mismatch and conflicts; preserves the user's index; never commits or pushes.",
      inputSchema: {
        id: Id,
        repoDir: z.string(),
        reviewToken: z.string().regex(/^[a-f0-9]{64}$/),
      },
    },
    (a) => respond(() => bridge.apply(a.id, a.repoDir, a.reviewToken)),
  );
  server.registerTool(
    "cc_discard_worker",
    {
      description:
        "Stop and remove worker resources. Unapplied patches are preserved unless discardPatch:true explicitly discards them.",
      inputSchema: { id: Id, discardPatch: z.boolean().default(false) },
    },
    (a) => respond(() => bridge.discard(a.id, a.discardPatch)),
  );
  server.registerTool(
    "cc_cancel_worker",
    {
      description:
        "Cancel a running worker by terminating its process group, without destroying uncollected changes. A Command Code worker never outlives the bridge, so a record left running has no live process.",
      inputSchema: { id: Id },
    },
    (a) => respond(() => bridge.cancel(a.id)),
  );
  server.registerTool(
    "cc_list_workers",
    {
      description:
        "Call after compaction, resume, or worker errors to recover durable worker state. Match the bridge UUID and repository; session ids are for interactive inspection only, not a resume handle for delegation. Preserve patches, inspect with cc_worker_diff, and use cc_delegate for the remaining work.",
    },
    () => respond(async () => ({ workers: await bridge.state.list() })),
  );
  return server;
}
