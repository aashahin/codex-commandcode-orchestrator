import { test, expect } from "bun:test";
import { embeddedObjects, emptyReport, parseReport } from "../src/prompts";
import { stderrNoise } from "../src/commandcode";
const valid = JSON.stringify({
  summary: "found it",
  findings: [
    { kind: "FACT", message: "evidence", file: "a.txt", severity: "high" },
  ],
  changes: [],
  tests: [],
  risks: [],
});
test("a bare JSON report is parsed directly", () => {
  const { report, warnings } = parseReport(valid);
  expect(warnings).toEqual([]);
  expect(report.summary).toBe("found it");
  expect(report.findings[0]!.severity).toBe("high");
});
test("a fenced JSON report is parsed", () => {
  const { report, warnings } = parseReport("```json\n" + valid + "\n```");
  expect(warnings).toEqual([]);
  expect(report.summary).toBe("found it");
});
test("a report wrapped in prose is still recovered", () => {
  const { report, warnings } = parseReport(
    `The shell command was blocked, so I reviewed statically.\n\n${valid}\n\nDone.`,
  );
  expect(warnings).toEqual([]);
  expect(report.summary).toBe("found it");
  expect(report.findings).toHaveLength(1);
});
test("the last validating object wins when prose contains other JSON", () => {
  const { report } = parseReport(
    `Shape example: {"shape":"example"}\nThen the real result:\n${valid}`,
  );
  expect(report.summary).toBe("found it");
  const reversed = parseReport(
    `${valid}\n\nFor reference the input was {"items":[1,2]}.`,
  );
  expect(reversed.report.summary).toBe("found it");
});
test("braces inside strings do not confuse the scanner", () => {
  expect(embeddedObjects('{"a":"}"}')).toEqual(['{"a":"}"}']);
  expect(embeddedObjects('{"a":"{nested}"}')).toEqual(['{"a":"{nested}"}']);
  expect(embeddedObjects('{"a":"escaped \\" quote"}')).toEqual([
    '{"a":"escaped \\" quote"}',
  ]);
  expect(embeddedObjects("no objects here")).toEqual([]);
  expect(embeddedObjects('{"outer":{"inner":1}}')).toEqual([
    '{"outer":{"inner":1}}',
  ]);
});
test("unstructured output falls back to unverified prose", () => {
  const { report, warnings } = parseReport("I could not complete the task.");
  expect(report.summary).toBe("I could not complete the task.");
  expect(report.findings).toEqual([]);
  expect(warnings).toHaveLength(1);
  expect(warnings[0]).toContain("unverified prose");
});
test("an object that is not a valid report is rejected", () => {
  const { warnings } = parseReport('{"unrelated":true}');
  expect(warnings).toHaveLength(1);
});
test("empty text yields an empty report without warnings", () => {
  expect(emptyReport()).toEqual({
    summary: "",
    findings: [],
    changes: [],
    tests: [],
    risks: [],
  });
  expect(parseReport("   ").warnings).toHaveLength(1);
  expect(parseReport("   ").report.summary).toBe("");
});
test("cmd flag confirmations on stderr are not treated as warnings", () => {
  expect(
    stderrNoise("Reasoning effort set to high for DeepSeek V4 Flash (latest)."),
  ).toBe("");
  expect(stderrNoise("Config set: theme=dark\n")).toBe("");
  expect(stderrNoise("Reasoning effort set to high\nsome real error")).toBe(
    "some real error",
  );
  expect(stderrNoise("Error: unknown model \"x\"")).toContain("unknown model");
  expect(stderrNoise("")).toBe("");
});
