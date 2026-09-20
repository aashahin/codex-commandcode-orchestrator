export const RECOVERY_GUIDANCE =
  "Recover through the commandcode_workers MCP bridge: call cc_health and cc_list_workers, identify the worker by its bridge UUID and repository, and inspect any partial patch with cc_worker_diff. Confirm a running worker has stopped through cc_cancel_worker before starting replacement work. Review and apply acceptable changes with cc_apply_worker_patch, then use cc_delegate for the remaining task against the original repository. A worker process never survives a bridge restart, so a record still marked running after a restart has no live process. Preserve unapplied patches. Never bypass the bridge with cmd -p, cmd --resume, or ad-hoc scripts. If MCP is unavailable, repair/reconnect it or report the blocker; do not change transport.";

export const WORKFLOW_GUIDANCE = `Command Code workers must use the commandcode_workers MCP bridge.
- Use cc_delegate or cc_delegate_parallel for all Command Code model work, including follow-up fixes and reviews. Keep Codex responsible for integration and final verification. Use the model the user asked for and do not silently change it. Discover exact ids and advertised reasoning efforts with cc_models.
- Route by model id. Command Code ids (deepseek/*, moonshotai/*, z-ai/*, zai-org/*, Qwen/*, MiniMaxAI/*, xiaomi/*, meituan/*, stepfun/*, tencent/*, nvidia/*, thinkingmachines/*, poolside/*, inclusionai/*, claude-*, gpt-*, google/*, xai/*, meta/*, sakana/*) belong to commandcode_workers. OpenCode ids (opencode-go/...) belong to the separate opencode_workers bridge. Never send one bridge's model id to the other.
- Never run cmd -p, cmd --resume, or any other direct Command Code CLI invocation or ad-hoc script as a worker substitute. The bridge is the only worker transport.
- After compaction, resume, or a worker error, recover current state before continuing. ${RECOVERY_GUIDANCE}
- Carry this transport requirement, the original repoDir, bridge worker UUIDs, model and requested effort, scope, patch review/application status, and the next MCP action into every handoff or compaction summary. A previous CLI command in a summary is history, not authorization to repeat it.
- The bridge snapshots the repository into a detached Git worktree. Worker changes are collected as a patch that Codex inspects and applies explicitly; nothing auto-commits or auto-pushes. Workers run with full tool access inside that worktree, so they may run shell and report real test output, but Codex runs the authoritative checks against the applied patch.
- These rules apply to Command Code workers. A user's explicit request for the opencode_workers or Grok workflows still follows those workflows' own instructions.`;

const begin = "<!-- codex-commandcode-orchestrator:begin -->";
const end = "<!-- codex-commandcode-orchestrator:end -->";

export function mergeGuidance(source: string) {
  const block = `${begin}\n## Command Code worker delegation and recovery\n\n${WORKFLOW_GUIDANCE}\n${end}`;
  const start = source.indexOf(begin);
  const finish = source.indexOf(end);
  if (start === -1 && finish === -1)
    return (
      source +
      (source.endsWith("\n") ? "\n" : source ? "\n\n" : "") +
      block +
      "\n"
    );
  if (
    start === -1 ||
    finish < start ||
    source.indexOf(begin, start + begin.length) !== -1 ||
    source.indexOf(end, finish + end.length) !== -1
  )
    throw Error(
      "Malformed orchestration instruction markers; existing instructions preserved",
    );
  return source.slice(0, start) + block + source.slice(finish + end.length);
}
