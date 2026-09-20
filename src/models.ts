import { catalog, catalogEntry } from "./catalog";
import { commandBinary, type Config } from "./config";
import { command } from "./git";
import { errorText } from "./security";
export interface LiveModel {
  id: string;
  description: string;
  section?: string;
  free: boolean;
  shortName: string;
  efforts?: string[];
  context?: string;
  minPlan?: string;
  vision?: boolean;
}
export interface ModelList {
  models: LiveModel[];
  source: "cmd --list-models" | "static metadata";
  warning?: string;
}
function footer(line: string) {
  return (
    line.startsWith("Pass the full id") ||
    line.startsWith("cmd ") ||
    line.startsWith("Docs:")
  );
}
export function declaredCount(output: string) {
  const match = /^Available models\s+·\s+(\d+) models/m.exec(output);
  return match ? Number(match[1]) : undefined;
}
export function parseModels(output: string) {
  const models: Omit<LiveModel, "shortName" | "free">[] = [];
  let section: string | undefined;
  for (const raw of output.split("\n")) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;
    if (footer(line.trim())) break;
    // "Available models  ·  72 models" also matches the id/description shape.
    if (line.startsWith("Available models")) continue;
    // Model rows are column aligned. The fallback covers an id long enough to
    // swallow its padding, which a single-space separator plus a slash detects.
    const match =
      /^(\S+) {2,}(\S.*)$/.exec(line) ?? /^(\S*\/\S+) (\S.*)$/.exec(line);
    if (!match) {
      if (line !== line.trimStart()) continue;
      section = line.trim();
      continue;
    }
    models.push({ id: match[1]!, description: match[2]!, section });
  }
  return models;
}
function merge(parsed: Omit<LiveModel, "shortName" | "free">[]): LiveModel[] {
  return parsed.map((model) => {
    const known = catalogEntry(model.id);
    return {
      ...model,
      shortName: model.id.slice(model.id.lastIndexOf("/") + 1),
      free: model.description.startsWith("FREE"),
      efforts: known?.efforts,
      context: known?.context,
      minPlan: known?.minPlan,
      vision: known?.vision,
    };
  });
}
export class ModelCatalog {
  private cached?: { at: number; list: ModelList };
  constructor(
    readonly config: Config,
    readonly ttlMs = 10 * 60 * 1000,
  ) {}
  async list(signal?: AbortSignal): Promise<ModelList> {
    if (this.cached && Date.now() - this.cached.at < this.ttlMs)
      return this.cached.list;
    const binary = commandBinary(this.config);
    try {
      const output = (
        await command([binary, "--list-models"], { max: 1024 ** 2, signal })
      ).toString();
      const models = merge(parseModels(output));
      if (!models.length) throw Error("no models were listed");
      const declared = declaredCount(output);
      const list: ModelList = {
        models,
        source: "cmd --list-models",
        ...(declared !== undefined && declared !== models.length
          ? {
              warning: `Parsed ${models.length} of the ${declared} models cmd advertises; a row may have been missed.`,
            }
          : {}),
      };
      this.cached = { at: Date.now(), list };
      return list;
    } catch (e) {
      // Fall back to the documented snapshot so routing still resolves, but say so.
      const list: ModelList = {
        models: merge(
          catalog.map((entry) => ({
            id: entry.id,
            description: entry.bestFor ?? entry.name,
            section: undefined,
          })),
        ),
        source: "static metadata",
        warning: `cmd --list-models failed (${errorText(e)}); ids come from a documentation snapshot and may be stale.`,
      };
      return list;
    }
  }
}
export function findModel(models: LiveModel[], wanted: string) {
  const target = wanted.toLowerCase();
  return models.find((model) => model.id.toLowerCase() === target);
}
