import { advertisedEfforts, validate } from "./catalog";
import { preferences, roles, type Config, type Role } from "./config";
import { findModel, type LiveModel } from "./models";
export interface Model {
  id: string;
  effort?: string;
  catalogued: boolean;
}
export function choose(
  role: Role,
  config: Config,
  models: LiveModel[],
  explicit?: string,
  effort?: string,
): Model {
  const requested =
    explicit ?? config.routing[role]?.[0] ?? preferences[role][0];
  if (!requested) throw Error(`No Command Code model configured for ${role}`);
  const resolved = validate(requested, effort);
  // cmd --list-models is the authority on id spelling; fall back to the request so
  // BYOK and custom provider ids still pass through to cmd for its own verdict.
  const live = findModel(models, resolved.id);
  const id = live?.id ?? resolved.id;
  const selected = resolved.effort;
  if (config.verifyEfforts && selected) {
    const advertised = live?.efforts ?? advertisedEfforts(id);
    if (advertised && !advertised.includes(selected))
      throw Error(
        `Model ${id} does not advertise effort ${selected}. Advertised: ${advertised.length ? advertised.join(", ") : "none"}`,
      );
  }
  if (role === "vision" && live && !live.vision)
    throw Error(`Model ${id} has no image input`);
  return { id, effort: selected, catalogued: Boolean(live) };
}
export function mappings(config: Config, models: LiveModel[] = []) {
  return Object.fromEntries(
    roles.map((role) => {
      try {
        const model = choose(role, config, models);
        return [
          role,
          model.effort
            ? { model: model.id, effort: model.effort }
            : { model: model.id },
        ];
      } catch {
        return [role, null];
      }
    }),
  );
}
