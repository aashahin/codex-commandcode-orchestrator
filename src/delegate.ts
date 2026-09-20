import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { TaskSchema, paths, VERSION, type Config, type Task } from "./config";
import { CommandCode, type Runtime } from "./commandcode";
import { catalog } from "./catalog";
import { command } from "./git";
import { providerProbe, recordProviderProbe } from "./diagnostics";
import { safeRelative, errorText, redact } from "./security";
import { snapshot, cleanup } from "./worktrees";
import { installOverlay, restoreOverlay } from "./overlay";
import { State, type WorkerRecord } from "./state";
import { collect, workerDiff, applyPatch } from "./patches";
import { Semaphore, parallel } from "./parallel";
import { choose, mappings } from "./router";
import { parseReport } from "./prompts";
import { RECOVERY_GUIDANCE } from "./guidance";
export class Bridge {
  readonly state: State;
  readonly gate: Semaphore;
  private active = new Map<string, AbortController>();
  private pending = new Set<Promise<unknown>>();
  private closing = false;
  private shutdown = new AbortController();
  constructor(
    readonly config: Config,
    readonly runtime: Runtime = new CommandCode(config),
    state = paths.state,
    readonly cache = paths.cache,
  ) {
    this.state = new State(state);
    this.gate = new Semaphore(config.parallelism);
  }
  async health() {
    const runtime = await this.runtime.health();
    const workers = await this.state.list();
    const counts: Record<string, number> = {};
    for (const worker of workers) {
      const status = (worker as { status?: string }).status;
      if (typeof status !== "string") continue;
      counts[status] = (counts[status] ?? 0) + 1;
    }
    const codex: { binary?: string; version?: string } = {
      binary: Bun.which("codex") ?? undefined,
    };
    if (codex.binary)
      try {
        codex.version = (await command(["codex", "--version"]))
          .toString()
          .trim()
          .split("\n")[0];
      } catch {}
    return {
      runtime: {
        ...runtime,
        lastLiveProbe: await providerProbe(this.state.root, "commandcode"),
      },
      codex,
      bridge: {
        version: VERSION,
        config: paths.config,
        state: this.state.root,
        cache: this.cache,
        parallelism: this.config.parallelism,
        maxTurns: this.config.maxTurns,
        guardrails: this.config.guardrails,
        running: this.active.size,
      },
      routing: mappings(this.config),
      workers: { total: workers.length, counts },
    };
  }
  async models() {
    return {
      routing: mappings(this.config),
      catalog,
      efforts: ["low", "medium", "high", "xhigh", "max"],
      source: "documented Command Code catalog snapshot",
      note: "Efforts are model-specific; entries listing none decide their own reasoning depth. Any BYOK or custom provider id is accepted and passed through as-is, and a non-effort suffix such as :free is preserved. Pass model as id or id:effort, or set effort separately.",
    };
  }
  delegate(input: unknown, signal?: AbortSignal) {
    if (this.closing) throw Error("Bridge is shutting down");
    const combined = AbortSignal.any([
      this.shutdown.signal,
      ...(signal ? [signal] : []),
    ]);
    const p = this.gate.run(
      () => this.execute(TaskSchema.parse(input), combined),
      combined,
    );
    this.pending.add(p);
    p.finally(() => this.pending.delete(p)).catch(() => {});
    return p;
  }
  private async execute(task: Task, parent?: AbortSignal) {
    task.scope.forEach(safeRelative);
    if (
      ["explorer", "reviewer"].includes(task.role) &&
      task.mode !== "read_only"
    )
      throw Error("Explorers and reviewers must be read-only");
    const model = choose(task.role, this.config, task.model, task.effort);
    const id = randomUUID();
    const controller = new AbortController();
    this.active.set(id, controller);
    const signal = AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(
        (task.timeoutSeconds ?? this.config.timeoutSeconds) * 1000,
      ),
      ...(parent ? [parent] : []),
    ]);
    const r: WorkerRecord = {
      id,
      role: task.role,
      model: model.key,
      requestedEffort: model.effort,
      status: "running",
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
      changedFiles: [],
    };
    await this.state.save(r);
    const warnings: string[] = [];
    let response;
    try {
      signal.throwIfAborted();
      r.snapshot = await snapshot(
        task.repoDir,
        id,
        this.config,
        this.state.dir(id),
        this.cache,
        signal,
      );
      await this.state.save(r);
      signal.throwIfAborted();
      if (this.config.guardrails)
        await installOverlay(r.snapshot.worktree, this.state.dir(id), task);
      response = await this.runtime.run(
        task,
        model,
        r.snapshot.worktree,
        signal,
        async (session) => {
          r.sessionID = session;
          await this.state.save(r);
        },
      );
      r.status = response.status;
      r.exitCode = response.exitCode;
      r.stopReason = response.stopReason;
      r.truncated = response.truncated;
      r.usage = response.usage;
      r.durationMs = response.durationMs;
      warnings.push(...response.warnings);
    } catch (e) {
      r.status = signal.aborted
        ? signal.reason?.name === "TimeoutError"
          ? "timed_out"
          : "cancelled"
        : "failed";
      warnings.push(errorText(e));
    }
    try {
      if (r.snapshot && r.status !== "quarantined") {
        if (this.config.guardrails)
          await restoreOverlay(r.snapshot.worktree, this.state.dir(id));
        await collect(r, this.state, this.config);
        if (task.mode === "read_only" && r.changedFiles.length) {
          r.status = "failed";
          warnings.push(
            "Read-only worker changed files; reject this result and inspect the preserved patch.",
          );
        }
      }
    } catch (e) {
      r.status = "quarantined";
      warnings.push(errorText(e));
    }
    const { report, warnings: parseWarnings } = parseReport(
      response?.text ?? "",
    );
    if (response) warnings.push(...parseWarnings);
    const result = {
      id,
      status: r.status,
      role: task.role,
      mode: task.mode,
      model: model.key,
      requestedEffort: model.effort,
      modelVerified: false,
      summary: report.summary,
      findings: report.findings,
      changes: report.changes,
      changedFiles: r.changedFiles,
      verification: task.verification.map((entry) => ({
        command: entry,
        status: "not_run",
        source: "bridge",
        reason:
          "Authoritative verification belongs to Codex; run this against the applied patch.",
      })),
      workerTestClaims: report.tests.map((t) => ({
        ...t,
        independentlyVerified: false,
      })),
      patchAvailable: Boolean(r.patchHash),
      patchId: r.patchHash ? id : undefined,
      warnings: [...warnings, ...report.risks],
      recovery: r.status === "completed" ? undefined : RECOVERY_GUIDANCE,
      sessionID: r.sessionID,
      sessionNote: r.sessionID
        ? "Inspect this worker transcript with cmd --resume <sessionID> in an interactive session."
        : undefined,
      worktree: r.snapshot?.worktree,
      exitCode: r.exitCode,
      stopReason: r.stopReason,
      truncated: r.truncated,
      durationMs: r.durationMs,
      usage: r.usage,
      tools: response?.tools ?? [],
    };
    r.result = {
      summary: redact(result.summary, 12000),
      status: result.status,
      warnings: result.warnings,
    };
    r.warning = warnings.join("; ");
    await this.state.save(r);
    this.active.delete(id);
    try {
      await recordProviderProbe(
        this.state.root,
        "commandcode",
        model.key,
        r.status === "completed",
        r.status === "completed"
          ? undefined
          : Error(warnings.at(0) ?? `Worker ended as ${r.status}`),
      );
    } catch {}
    return result;
  }
  async delegateParallel(
    tasks: unknown[],
    concurrency = this.config.parallelism,
    signal?: AbortSignal,
  ) {
    if (tasks.length < 1 || tasks.length > 16)
      throw Error("Supply 1–16 independent tasks");
    const start = Date.now();
    const results = await parallel(
      tasks,
      Math.min(concurrency, this.config.parallelism),
      (t) => this.delegate(t, signal),
      signal,
    );
    return {
      elapsedMs: Date.now() - start,
      concurrency: Math.min(concurrency, this.config.parallelism),
      results: results.map((r) =>
        r.status === "fulfilled"
          ? r.value
          : { status: "failed", error: errorText(r.reason) },
      ),
    };
  }
  diff(id: string, offset = 0, limit = 20000) {
    return workerDiff(
      this.state,
      id,
      offset,
      Math.min(limit, this.config.maxOutputBytes),
    );
  }
  apply(id: string, repoDir: string, token: string) {
    return applyPatch(this.state, id, repoDir, token);
  }
  async discard(id: string, discardPatch = false) {
    this.active.get(id)?.abort(Error("Cancelled by orchestrator"));
    if (this.active.has(id))
      throw Error(
        "Worker cancellation requested; wait for its result, then discard",
      );
    return this.state.lock("worker-" + id, async () => {
      const r = await this.state.get(id);
      if (r.status === "discarded") return { id, status: "discarded" };
      if (r.snapshot) {
        if (this.config.guardrails)
          await restoreOverlay(r.snapshot.worktree, this.state.dir(id));
        if (r.status !== "applied") await collect(r, this.state, this.config);
      }
      if (r.patchHash && r.status !== "applied" && !discardPatch) {
        r.status = "failed";
        await this.state.save(r);
        return {
          id,
          status: "preserved",
          patchAvailable: true,
          message:
            "Worker changes collected. Inspect the patch or explicitly set discardPatch:true.",
        };
      }
      if (r.snapshot) await cleanup(r.snapshot, this.cache);
      await rm(join(this.state.dir(id), "worker.patch"), { force: true });
      r.status = "discarded";
      r.patchHash = undefined;
      r.snapshot = undefined;
      r.result = undefined;
      await this.state.save(r);
      return { id, status: "discarded" };
    });
  }
  async cancel(id: string) {
    const controller = this.active.get(id);
    if (controller) {
      controller.abort(Error("Cancelled by orchestrator"));
      return { id, status: "cancellation_requested" };
    }
    const r = await this.state.get(id);
    if (r.status === "running") {
      r.status = "cancelled";
      r.warning =
        "No live worker process; Command Code workers do not outlive the bridge.";
      await this.state.save(r);
      return { id, status: "cancelled", message: r.warning };
    }
    return {
      id,
      status: r.status,
      message:
        "No live worker process. Use cc_discard_worker to collect and clean up resources.",
    };
  }
  async reconcile() {
    for (const worker of await this.state.list(true)) {
      if (!("status" in worker) || worker.status !== "running") continue;
      try {
        const r = await this.state.get(worker.id);
        if (this.active.has(r.id)) continue;
        r.status = "cancelled";
        r.warning =
          "Bridge restarted; the worker process no longer exists. Inspect any preserved patch.";
        await this.state.save(r);
      } catch {}
    }
  }
  async close() {
    this.closing = true;
    this.shutdown.abort(Error("MCP connection closed"));
    for (const c of this.active.values())
      c.abort(Error("MCP connection closed"));
    await Promise.allSettled([...this.pending]);
  }
}
