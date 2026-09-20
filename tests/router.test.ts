import { test, expect } from "bun:test";
import { catalog, catalogEntry, parseModel, validate } from "../src/catalog";
import { choose, mappings } from "../src/router";
import { ConfigSchema, preferences } from "../src/config";
const config = ConfigSchema.parse({});
test("model ids with a non-effort suffix are preserved", () => {
  expect(parseModel("inclusionai/ling-3.0-flash-sante:free")).toEqual({
    id: "inclusionai/ling-3.0-flash-sante:free",
    effort: undefined,
  });
  expect(parseModel("gpt-5.6-sol:xhigh")).toEqual({
    id: "gpt-5.6-sol",
    effort: "xhigh",
  });
  expect(parseModel("deepseek/deepseek-v4-flash")).toEqual({
    id: "deepseek/deepseek-v4-flash",
    effort: undefined,
  });
});
test("the catalog suffix case keeps its own entry", () => {
  expect(catalogEntry("inclusionai/ling-3.0-flash-sante:free")?.name).toBe(
    "Ling 3.0 Flash Sante",
  );
});
test("an effort the model does not advertise is refused", () => {
  expect(() => validate("claude-haiku-4-5-20251001", "max")).toThrow(
    "does not advertise effort max",
  );
  expect(validate("gpt-5.6-sol", "xhigh").effort).toBe("xhigh");
});
test("a conflicting model and effort pair is refused", () => {
  expect(() => validate("gpt-5.6-sol:xhigh", "low")).toThrow("Conflicting");
  expect(validate("gpt-5.6-sol:xhigh", "xhigh").effort).toBe("xhigh");
});
test("an unknown BYOK id passes through with any effort", () => {
  expect(validate("my-ollama/qwen3", "max")).toEqual({
    id: "my-ollama/qwen3",
    effort: "max",
    known: false,
  });
  expect(choose("explorer", config, "my-ollama/qwen3").catalogued).toBe(false);
});
test("the requested model always wins and is never silently changed", () => {
  const model = choose("cheap", config, "claude-opus-5");
  expect(model.key).toBe("claude-opus-5");
  const withEffort = choose("explorer", config, "Qwen/Qwen3.8-Max", "xhigh");
  expect(withEffort.key).toBe("Qwen/Qwen3.8-Max:xhigh");
});
test("a non-vision model is refused for the vision role", () => {
  expect(() => choose("vision", config, "gpt-5.6-sol")).toThrow(
    "image input",
  );
  expect(choose("vision", config).key).toBe(
    preferences.vision[0] as string,
  );
});
test("routing preferences from config take precedence over defaults", () => {
  const custom = ConfigSchema.parse({
    routing: { implementer: ["zai-org/GLM-5.3"] },
  });
  expect(choose("implementer", custom).key).toBe("zai-org/GLM-5.3");
  expect(choose("explorer", custom).key).toBe(preferences.explorer[0]);
  const map = mappings(custom);
  expect(map.implementer).toBe("zai-org/GLM-5.3");
  expect(Object.keys(map)).toHaveLength(6);
});
test("every default routing entry resolves from the catalog", () => {
  for (const id of Object.values(preferences).flat()) {
    expect(catalogEntry(id)).toBeDefined();
  }
});
test("the catalog has no duplicate ids and every entry has a name", () => {
  const ids = catalog.map((entry) => entry.id);
  expect(new Set(ids).size).toBe(ids.length);
  for (const entry of catalog) expect(entry.name.length).toBeGreaterThan(0);
});
test("routing failure is reported rather than thrown for cc_models", () => {
  const broken = ConfigSchema.parse({ routing: { explorer: ["not a model id"] } });
  expect(mappings(broken).explorer).toBeNull();
});
