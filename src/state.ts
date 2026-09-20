import {
  mkdir,
  readFile,
  writeFile,
  rename,
  rm,
  readdir,
  stat,
} from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { paths } from "./config";
import { validId, errorText } from "./security";
import type { Snapshot } from "./worktrees";
export type WorkerStatus =
  | "running"
  | "completed"
  | "failed"
  | "timed_out"
  | "cancelled"
  | "applied"
  | "discarded"
  | "quarantined";
export interface WorkerRecord {
  id: string;
  role: string;
  model: string;
  requestedEffort?: string;
  status: WorkerStatus;
  created: string;
  updated: string;
  sessionID?: string;
  snapshot?: Snapshot;
  patchHash?: string;
  changedFiles: string[];
  artifacts?: { count: number; sample: string[] };
  collected?: boolean;
  reviewedBytes?: number;
  exitCode?: number;
  stopReason?: string;
  truncated?: boolean;
  usage?: unknown;
  durationMs?: number;
  result?: unknown;
  warning?: string;
}
export class State {
  constructor(readonly root = paths.state) {}
  dir(id: string) {
    return join(this.root, "workers", validId(id));
  }
  async save(record: WorkerRecord) {
    const dir = this.dir(record.id);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const tmp = join(dir, `record-${randomUUID()}.tmp`);
    record.updated = new Date().toISOString();
    await writeFile(tmp, JSON.stringify(record), { mode: 0o600 });
    await rename(tmp, join(dir, "record.json"));
  }
  async get(id: string): Promise<WorkerRecord> {
    try {
      return JSON.parse(
        await readFile(join(this.dir(id), "record.json"), "utf8"),
      );
    } catch {
      throw Error("Worker not found or invalid state");
    }
  }
  async list(includeDiscarded = false) {
    await mkdir(join(this.root, "workers"), { recursive: true, mode: 0o700 });
    const result = [];
    for (const id of await readdir(join(this.root, "workers"))) {
      try {
        const r = await this.get(id);
        if (!includeDiscarded && r.status === "discarded") continue;
        result.push({
          id: r.id,
          role: r.role,
          model: r.model,
          requestedEffort: r.requestedEffort,
          status: r.status,
          stopReason: r.stopReason,
          truncated: r.truncated,
          usage: r.usage,
          exitCode: r.exitCode,
          repo: r.snapshot?.repo,
          worktree: r.snapshot?.worktree,
          created: r.created,
          updated: r.updated,
          patchAvailable: Boolean(r.patchHash),
          warning: r.warning,
        });
      } catch (e) {
        result.push({ id, error: errorText(e) });
      }
    }
    return result;
  }
  async lock<T>(key: string, fn: () => Promise<T>) {
    if (!/^[\w-]+$/.test(key)) throw Error("Invalid lock");
    const dir = join(this.root, "locks", key);
    await mkdir(join(this.root, "locks"), { recursive: true, mode: 0o700 });
    try {
      await mkdir(dir, { mode: 0o700 });
    } catch {
      throw Error(
        "Operation locked by another bridge process. Retry after it finishes; inspect stale locks with doctor.",
      );
    }
    try {
      await writeFile(
        join(dir, "owner.json"),
        JSON.stringify({ pid: process.pid, created: new Date().toISOString() }),
        { mode: 0o600 },
      );
      return await fn();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
  // A lock whose owner is gone would otherwise block its worker forever.
  async releaseStaleLocks(graceMs = 60000) {
    const root = join(this.root, "locks");
    const released: string[] = [];
    let entries: string[];
    try {
      entries = await readdir(root);
    } catch {
      return released;
    }
    for (const key of entries) {
      const dir = join(root, key);
      let owner: { pid?: unknown } | undefined;
      try {
        owner = JSON.parse(await readFile(join(dir, "owner.json"), "utf8"));
      } catch {}
      let stale: boolean;
      if (typeof owner?.pid === "number" && Number.isInteger(owner.pid))
        stale = !alive(owner.pid);
      else {
        // The owner record never landed, so fall back to age rather than race a
        // lock that is still being created.
        const age = await stat(dir).then(
          (value) => value.mtimeMs,
          () => undefined,
        );
        stale = age !== undefined && Date.now() - age > graceMs;
      }
      if (!stale) continue;
      await rm(dir, { recursive: true, force: true });
      released.push(key);
    }
    return released;
  }
}
function alive(pid: number) {
  if (pid === process.pid) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}
