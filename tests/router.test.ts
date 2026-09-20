import { test, expect } from "bun:test";
import { catalog, catalogEntry, parseModel, validate } from "../src/catalog";
import { choose, mappings } from "../src/router";
import { parseModels } from "../src/models";
import { ConfigSchema, preferences } from "../src/config";
import { models } from "./helpers";
const config = ConfigSchema.parse({});
const sample = `Available models  ·  72 models

Open Source

deepseek/deepseek-v4-flash             fast hybrid-attention reasoning (default)
poolside/laguna-s-2.1-free             FREE open-weight agentic coding

Anthropic

claude-sonnet-5                        best combo of speed & intelligence (recommended)

xAI

xai/grok-4.5                           smartest model for coding

Pass the full id, or just the short name after the last "/":
cmd --model moonshotai/kimi-k2.5
cmd --model kimi-k2.5

Docs:  https://commandcode.ai/docs/reference/cli/models
`;
test("cmd --list-models output is parsed into sections and models", () => {
  const parsed = parseModels(sample);
  expect(parsed.map((m) => m.id)).toEqual([
    "deepseek/deepseek-v4-flash",
    "poolside/laguna-s-2.1-free",
    "claude-sonnet-5",
    "xai/grok-4.5",
  ]);
  expect(parsed.map((m) => m.section)).toEqual([
    "Open Source",
    "Open Source",
    "Anthropic",
    "xAI",
  ]);
  expect(parsed[0]!.description).toBe(
    "fast hybrid-attention reasoning (default)",
  );
});
test("the trailing help and docs block is never parsed as models", () => {
  const parsed = parseModels(sample);
  expect(parsed.some((m) => m.id === "cmd")).toBe(false);
  expect(parsed.some((m) => m.id === "Docs:")).toBe(false);
  expect(parsed).toHaveLength(4);
});
test("a model id carrying a non-effort suffix survives parsing", () => {
  const parsed = parseModels(
    "Available models  ·  1 models\n\nOpen Source\n\ninclusionai/ling-3.0-flash-sante:free  FREE health tuning\n",
  );
  expect(parsed[0]!.id).toBe("inclusionai/ling-3.0-flash-sante:free");
});
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
test("catalog lookup ignores casing so documentation ids still resolve", () => {
  expect(catalogEntry("Qwen/Qwen3.8-Max")?.id).toBe("Qwen/Qwen3.8-Max");
  expect(catalogEntry("qwen/qwen3.8-max")?.id).toBe("Qwen/Qwen3.8-Max");
  expect(catalogEntry("MoonshotAI/Kimi-K3")?.efforts).toEqual([
    "low",
    "high",
    "max",
  ]);
});
test("a conflicting model and effort pair is refused", () => {
  expect(() => validate("gpt-5.6-sol:xhigh", "low")).toThrow("Conflicting");
  expect(validate("gpt-5.6-sol:xhigh", "xhigh")).toEqual({
    id: "gpt-5.6-sol",
    effort: "xhigh",
  });
  expect(() => validate("not a model id")).toThrow("Invalid model id");
});
test("the docs casing is normalised to the id cmd actually reports", () => {
  expect(choose("reviewer", config, models, "Qwen/Qwen3.8-Max").id).toBe(
    "qwen/qwen3.8-max",
  );
  expect(
    choose("implementer", config, models, "moonshotai/Kimi-K2.7-Code").id,
  ).toBe("moonshotai/kimi-k2.7-code");
  expect(choose("cheap", config, models, "zai-org/GLM-5.3").id).toBe(
    "zai-org/glm-5.3",
  );
});
test("effort is validated against the live list and rejected when absent", () => {
  expect(
    choose("reviewer", config, models, "qwen/qwen3.8-max", "xhigh"),
  ).toEqual({ id: "qwen/qwen3.8-max", effort: "xhigh", catalogued: true });
  expect(() =>
    choose("reviewer", config, models, "qwen/qwen3.8-max", "max"),
  ).toThrow("does not advertise effort max");
  expect(() =>
    choose("reviewer", config, models, "claude-haiku-4-5-20251001", "high"),
  ).toThrow("Advertised: none");
});
test("verifyEfforts:false defers the effort decision to cmd", () => {
  const off = ConfigSchema.parse({ verifyEfforts: false });
  expect(
    choose("reviewer", off, models, "claude-haiku-4-5-20251001", "max"),
  ).toEqual({
    id: "claude-haiku-4-5-20251001",
    effort: "max",
    catalogued: true,
  });
});
test("an unknown or BYOK id passes through to cmd unchanged", () => {
  expect(choose("explorer", config, models, "my-ollama/qwen3", "max")).toEqual({
    id: "my-ollama/qwen3",
    effort: "max",
    catalogued: false,
  });
  expect(choose("explorer", config, models, "my-ollama/qwen3").effort).toBe(
    undefined,
  );
});
test("the requested model always wins and is never silently changed", () => {
  expect(choose("cheap", config, models, "claude-opus-5").id).toBe(
    "claude-opus-5",
  );
});
test("a non-vision model is refused for the vision role", () => {
  expect(() => choose("vision", config, models, "gpt-5.6-sol")).toThrow(
    "image input",
  );
  expect(choose("vision", config, models).id).toBe(
    "deepseek/deepseek-v4-flash-vision-exp",
  );
});
test("routing preferences from config take precedence over defaults", () => {
  const custom = ConfigSchema.parse({
    routing: { implementer: ["zai-org/GLM-5.3:max"] },
  });
  expect(choose("implementer", custom, models)).toEqual({
    id: "zai-org/glm-5.3",
    effort: "max",
    catalogued: true,
  });
  const map = mappings(custom, models);
  expect(map.implementer).toEqual({
    model: "zai-org/glm-5.3",
    effort: "max",
  });
  expect(map.explorer).toEqual({ model: "deepseek/deepseek-v4-flash" });
  expect(Object.keys(map)).toHaveLength(6);
});
test("every default routing entry resolves against the live list", () => {
  for (const id of Object.values(preferences).flat()) {
    const resolved = choose("explorer", config, models, id);
    expect(resolved.catalogued).toBe(true);
    expect(resolved.id).toBe(id);
    expect(catalogEntry(id)).toBeDefined();
  }
});
test("the catalog has no duplicate ids and every entry has a name", () => {
  const ids = catalog.map((entry) => entry.id);
  expect(new Set(ids).size).toBe(ids.length);
  for (const entry of catalog) expect(entry.name.length).toBeGreaterThan(0);
});
test("routing failure is reported rather than thrown for cc_models", () => {
  const broken = ConfigSchema.parse({
    routing: { explorer: ["not a model id"] },
  });
  expect(mappings(broken, models).explorer).toBeNull();
});
