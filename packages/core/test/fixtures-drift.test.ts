import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { extractFixtures } from "../scripts/extract-fixtures.js";
import { NegotiationRequestSchema } from "../src/index.js";

const repoRoot = resolve(import.meta.dirname, "../../..");
const fixturesDir = resolve(import.meta.dirname, "../fixtures/examples");
const extracted = extractFixtures(readFileSync(join(repoRoot, "SPEC.md"), "utf8"));

// EX-10 is INVALID_INPUT by design. EX-09/12/13/23 inputs are schema-valid-ish but fail later in the pipeline
// (assert only that `input` is an object for those; EX-09 and EX-23 carry deliberately bad rule/zone data).
const NOT_SCHEMA_CHECKED = new Set(["EX-09", "EX-10", "EX-12", "EX-13", "EX-23"]);

describe("fixtures drift (SPEC.md section 6 -> fixtures/examples)", () => {
  it("extracts 24 examples EX-01..EX-24 in order", () => {
    expect(extracted.map((e) => e.id)).toEqual(
      Array.from({ length: 24 }, (_, i) => `EX-${String(i + 1).padStart(2, "0")}`),
    );
  });

  it.each(extracted.map((e) => [e.id, e] as const))("%s matches the committed file byte for byte", (id, e) => {
    const file = join(fixturesDir, `${id.toLowerCase()}.json`);
    expect(readFileSync(file, "utf8")).toBe(e.json);
    expect(e.json).not.toContain("\r");
  });

  it.each(extracted.map((e) => [e.id, JSON.parse(e.json) as { input: unknown }] as const))(
    "%s input shape",
    (id, fixture) => {
      if (NOT_SCHEMA_CHECKED.has(id)) {
        expect(typeof fixture.input).toBe("object");
        return;
      }
      expect(NegotiationRequestSchema.safeParse(fixture.input).success).toBe(true);
    },
  );

  it("fails loudly on an unrecognised Input line, naming the example and the line", () => {
    const spec = readFileSync(join(repoRoot, "SPEC.md"), "utf8").replace(
      "- options: now=`2025-01-03T12:00:00Z` (other options at defaults)",
      "- frobnicate: yes",
    );
    expect(() => extractFixtures(spec)).toThrow(/EX-01.*frobnicate: yes/);
  });
});
