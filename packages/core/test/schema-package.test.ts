import { execFileSync, execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const coreDir = resolve(import.meta.dirname, "..");
const repoRoot = resolve(coreDir, "../..");
const pkg = JSON.parse(readFileSync(join(coreDir, "package.json"), "utf8")) as {
  files: string[];
  exports: Record<string, unknown>;
  scripts: Record<string, string>;
};

describe("rules.schema.json ships in @marvinliem/tempo-core (A-82)", () => {
  beforeAll(() => {
    // The same command `build` and `prepack` run.
    execFileSync(process.execPath, ["--import", "tsx", "scripts/copy-schema.ts"], { cwd: coreDir });
  });

  it("the build copy is byte-identical to the committed schema", () => {
    const copy = readFileSync(join(coreDir, "schema", "rules.schema.json"));
    const root = readFileSync(join(repoRoot, "schema", "rules.schema.json"));
    expect(copy.equals(root)).toBe(true);
  });

  it('package.json "files" includes "schema"', () => {
    expect(pkg.files).toContain("schema");
  });

  it("exports the schema as a subpath", () => {
    expect(pkg.exports["./rules.schema.json"]).toBe("./schema/rules.schema.json");
  });

  it("build and prepack run the copy step", () => {
    expect(pkg.scripts.build).toContain("scripts/copy-schema.ts");
    expect(pkg.scripts.prepack).toContain("scripts/copy-schema.ts");
  });

  it("npm pack lists the schema and no sources, tests or fixtures", () => {
    const out = execSync("npm pack --dry-run --json --ignore-scripts", { cwd: coreDir, encoding: "utf8" });
    const files = (JSON.parse(out) as { files: { path: string }[] }[])[0]!.files.map((f) => f.path);
    expect(files).toContain("schema/rules.schema.json");
    expect(files.filter((f) => /^(src|test|fixtures|scripts)\//.test(f))).toEqual([]);
  });

  it("the packaged schema is JSON Schema 2020-12", () => {
    const schema = JSON.parse(readFileSync(join(coreDir, "schema", "rules.schema.json"), "utf8")) as { $schema: string };
    expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
  });
});
