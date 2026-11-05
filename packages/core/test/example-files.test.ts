import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import Ajv2020Module from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { evaluate } from "../src/index.js";
import type { NegotiationRequest } from "../src/index.js";

// ajv is CJS: under NodeNext the default import is the module namespace, so unwrap `.default`.
const Ajv2020 = Ajv2020Module.default;

const repoRoot = resolve(import.meta.dirname, "../../..");
const examplesDir = join(repoRoot, "examples");
const validate = new Ajv2020().compile(
  JSON.parse(readFileSync(join(repoRoot, "schema", "rules.schema.json"), "utf8")) as object,
);

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
  );
}
const rel = (p: string) => relative(examplesDir, p).split("\\").join("/");
const jsonFiles = walk(examplesDir).filter((f) => f.endsWith(".json")).map(rel);
const inputs = jsonFiles.filter((f) => f === "demo.json" || f.startsWith("inputs/"));
const read = (f: string): unknown => JSON.parse(readFileSync(join(examplesDir, f), "utf8"));

describe("examples/ (CORE-41, M4)", () => {
  it("has the demo and one input per feature", () => {
    expect(inputs.sort()).toEqual([
      "demo.json",
      "inputs/ambiguous-zone.json",
      "inputs/blackout.json",
      "inputs/dst-spring-forward.json",
      "inputs/non-ascii-party.json",
      "inputs/overnight.json",
    ]);
  });

  it.each(["demo.json", "inputs/ambiguous-zone.json", "inputs/blackout.json", "inputs/dst-spring-forward.json", "inputs/non-ascii-party.json", "inputs/overnight.json"])(
    "%s validates against schema/rules.schema.json",
    (f) => {
      const ok = validate(read(f));
      expect(ok, JSON.stringify(validate.errors)).toBe(true);
    },
  );

  it("every JSON file under examples/ is an input, an expected output or an n8n file", () => {
    const others = jsonFiles.filter((f) => !inputs.includes(f));
    for (const f of others) expect(f === "demo.explain.json" || f.startsWith("n8n/"), f).toBe(true);
  });

  it("a request without participants does NOT validate (the validator is live)", () => {
    const rest = structuredClone(read("demo.json")) as Record<string, unknown>;
    delete rest["participants"];
    expect(validate(rest)).toBe(false);
  });

  it("ambiguous-zone.json is schema-shaped but core rejects it with AMBIGUOUS_ZONE", () => {
    const r = evaluate(read("inputs/ambiguous-zone.json") as NegotiationRequest);
    expect(r.ok).toBe(false);
    expect(r.ok ? "" : r.error.code).toBe("AMBIGUOUS_ZONE");
  });

  it("the other inputs are successful computations", () => {
    for (const f of inputs.filter((x) => x !== "inputs/ambiguous-zone.json")) {
      expect(evaluate(read(f) as NegotiationRequest).ok, f).toBe(true);
    }
  });
});
