import { z } from "zod";
import type { Task } from "./config";
import { redact } from "./security";
export const ReportSchema = z.object({
  summary: z.string().max(12000),
  findings: z
    .array(
      z.object({
        kind: z.enum(["FACT", "INFERENCE", "RECOMMENDATION"]),
        message: z.string().max(3000),
        file: z.string().optional(),
        severity: z
          .enum(["info", "low", "medium", "high", "critical"])
          .default("info"),
      }),
    )
    .max(100)
    .default([]),
  changes: z
    .array(z.object({ file: z.string(), reason: z.string().max(2000) }))
    .max(100)
    .default([]),
  tests: z
    .array(
      z.object({
        command: z.string(),
        result: z.string(),
        passed: z.boolean().nullable(),
      }),
    )
    .max(30)
    .default([]),
  risks: z.array(z.string().max(2000)).max(30).default([]),
});
export type Report = z.infer<typeof ReportSchema>;
export function emptyReport(): Report {
  return { summary: "", findings: [], changes: [], tests: [], risks: [] };
}
export function contract(task: Task, worktree: string) {
  const mode =
    task.mode === "read_only"
      ? "READ-ONLY. You are in plan mode; make no edits and no mutating changes."
      : "WRITE-ISOLATED. Edit files only inside this worktree, and leave every change uncommitted in the working tree so the orchestrator can collect it as a patch.";
  return redact(
    `You are a bounded worker for a Codex principal orchestrator. Codex owns architecture, integration and final acceptance. Complete the objective below and do not make architectural or integration decisions.

WORKTREE
${worktree}
This is an isolated Git worktree snapshotted from the user's repository, including the user's uncommitted edits. Changes here do NOT touch the user's checkout and are only collected as a patch.

MODE
${mode}

ROLE
${task.role}

OBJECTIVE
${task.task}

SCOPE
${task.scope.length ? task.scope.join("\n") : "Relevant source files only"}

CONSTRAINTS
${task.constraints.length ? task.constraints.join("\n") : "None beyond the prohibitions below"}

SHELL
You may run shell commands to inspect the repository and to run builds, linters or tests. Report only commands you actually ran, with the result you actually observed. Codex re-runs authoritative checks, so never claim a check passed that you did not see pass.

EXPECTED OUTPUT
After completing the work, return ONLY one JSON result object, without markdown or a schema. Use this shape with your actual findings: {"summary":"what you did or found","findings":[{"kind":"FACT","message":"evidence","file":"path","severity":"info"}],"changes":[{"file":"path","reason":"why"}],"tests":[{"command":"test command","result":"observed result","passed":true}],"risks":[]}. Use empty arrays where appropriate. For analysis, distinguish FACT, INFERENCE, RECOMMENDATION.

VERIFICATION
${task.verification.length ? task.verification.join("\n") : "Propose the checks Codex should run against the collected patch."}

PROHIBITED ACTIONS
No nested agents or sub-agents. No git commit, git push, git remote changes, branch or ref changes, or git worktree. No edits under .git. No writes outside this worktree. No changes to global Command Code or Codex configuration. No credential access, deployment, or publishing.`,
    40000,
  );
}
export function embeddedObjects(text: string) {
  const found: string[] = [];
  let depth = 0;
  let start = -1;
  let quoted = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (char === "}") {
      depth--;
      if (depth === 0 && start >= 0) {
        found.push(text.slice(start, i + 1));
        start = -1;
      }
    }
  }
  return found;
}
export function parseReport(text: string): {
  report: Report;
  warnings: string[];
} {
  let raw = text.trim();
  if (
    (raw.startsWith("```json\n") || raw.startsWith("```\n")) &&
    raw.endsWith("```")
  )
    raw = raw.slice(raw.indexOf("\n") + 1, -3).trim();
  // Workers often wrap the contract object in prose, so fall back to the last
  // balanced object in the text before giving up on structure entirely.
  for (const candidate of [raw, ...embeddedObjects(raw).reverse()]) {
    try {
      return { report: ReportSchema.parse(JSON.parse(candidate)), warnings: [] };
    } catch {}
  }
  return {
    report: {
      summary: redact(raw, 12000),
      findings: [],
      changes: [],
      tests: [],
      risks: [],
    },
    warnings: [
      "Worker output failed JSON schema validation; treat summary as unverified prose.",
    ],
  };
}
