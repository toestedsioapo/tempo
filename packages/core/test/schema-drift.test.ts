import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import Ajv2020Module from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { renderRulesJsonSchema } from "../scripts/rules-schema.js";
import { validRequest, withChange } from "./helpers.js";

// ajv is CJS: under NodeNext the default import is the module namespace, so unwrap `.default`.
const Ajv2020 = Ajv2020Module.default;

// All paths come from import.meta.dirname (packages/core/test), never process.cwd().
const repoRoot = resolve(import.meta.dirname, "../../..");
const schemaPath = join(repoRoot, "schema", "rules.schema.json");
const fixturesDir = resolve(import.meta.dirname, "../fixtures/examples");

function compile() {
  const ajv = new Ajv2020();
  return ajv.compile(JSON.parse(readFileSync(schemaPath, "utf8")) as object);
}

describe("schema/rules.schema.json", () => {
  it("matches the generator output exactly (no drift)", () => {
    expect(readFileSync(schemaPath, "utf8")).toBe(renderRulesJsonSchema());
  });

  it("uses LF line endings only", () => {
    expect(readFileSync(schemaPath, "utf8")).not.toContain("\r");
  });

  it("accepts the valid helper request", () => {
    expect(compile()(validRequest())).toBe(true);
  });

  it.each(readdirSync(fixturesDir).filter((f) => f.endsWith(".json")))(
    "accepts the input of fixture %s",
    (file) => {
      const fixture = JSON.parse(readFileSync(join(fixturesDir, file), "utf8")) as { input: unknown };
      expect(compile()(fixture.input)).toBe(true);
    },
  );

  const rejected: [string, () => unknown][] = [
    ["empty object", () => ({})],
    ["one participant", () => {
      const r = validRequest() as { participants: unknown[] };
      return withChange(["participants"], r.participants.slice(0, 1));
    }],
    ["participant with extra key timezone", () => withChange(["participants", 0, "timezone"], "UTC")],
    ["weeklyRules key Monday", () =>
      withChange(["participants", 0, "weeklyRules"], { Monday: [{ start: "09:00", end: "17:00" }] })],
    ["missing options.now", () => withChange(["options", "now"], undefined)],
  ];
  it.each(rejected)("rejects: %s", (_name, build) => {
    expect(compile()(build())).toBe(false);
  });
});
