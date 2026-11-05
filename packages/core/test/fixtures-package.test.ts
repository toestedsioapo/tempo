import { execFileSync, execSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const coreDir = resolve(import.meta.dirname, "..");
const pkg = JSON.parse(readFileSync(join(coreDir, "package.json"), "utf8")) as {
  files: string[];
  exports: Record<string, unknown>;
  scripts: Record<string, string>;
};

const fixtureFiles = (sub: string): string[] => {
  try {
    return readdirSync(join(coreDir, "fixtures", sub)).filter((f) => f.endsWith(".json")).map((f) => `fixtures/${sub}/${f}`);
  } catch {
    return [];
  }
};

describe("fixtures ship in @marvinliem/tempo-core (A-89)", () => {
  beforeAll(() => {
    execFileSync(process.execPath, ["--import", "tsx", "scripts/copy-schema.ts"], { cwd: coreDir });
  });

  it('exports "./fixtures/*" and leaves the "." export alone', () => {
    expect(pkg.exports["./fixtures/*"]).toBe("./fixtures/*");
    expect(pkg.exports["."]).toEqual({ types: "./dist/index.d.ts", import: "./dist/index.js" });
  });

  it('package.json "files" includes "fixtures"', () => {
    expect(pkg.files).toContain("fixtures");
  });

  it("npm pack lists every fixture file and the lock", () => {
    const out = execSync("npm pack --dry-run --json --ignore-scripts", { cwd: coreDir, encoding: "utf8" });
    const files = (JSON.parse(out) as { files: { path: string }[] }[])[0]!.files.map((f) => f.path);
    const expected = [...fixtureFiles("examples"), ...fixtureFiles("dst"), "fixtures/fixtures.lock.json"];
    expect(expected.length).toBeGreaterThan(24);
    for (const f of expected) expect(files).toContain(f);
  });
});
