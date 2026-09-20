import { catalogEntry, validate } from "./catalog";
import { preferences, roles, type Config, type Role } from "./config";
export interface Model {
  id: string;
  effort?: string;
  key: string;
  catalogued: boolean;
}
export function choose(
  role: Role,
  config: Config,
  explicit?: string,
  effort?: string,
): Model {
  const requested =
    explicit ?? config.routing[role]?.[0] ?? preferences[role][0];
  if (!requested) throw Error(`No Command Code model configured for ${role}`);
  const resolved = validate(requested, effort);
  const known = catalogEntry(resolved.id);
  if (role === "vision" && known && !known.vision)
    throw Error(`Model ${resolved.id} has no image input`);
  return {
    id: resolved.id,
    effort: resolved.effort,
    key: resolved.effort ? `${resolved.id}:${resolved.effort}` : resolved.id,
    catalogued: resolved.known,
  };
}
export function mappings(config: Config) {
  return Object.fromEntries(
    roles.map((r) => {
      try {
        return [r, choose(r, config).key];
      } catch {
        return [r, null];
      }
    }),
  );
}
