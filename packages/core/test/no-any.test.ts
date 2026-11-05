import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(import.meta.dirname, "../../..");
const srcDir = resolve(import.meta.dirname, "../src");
const eslint = new ESLint({ cwd: repoRoot });

function productionSources(): string[] {
  return readdirSync(srcDir)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .map((f) => join(srcDir, f));
}

describe("QG-04: no type-safety escapes in core", () => {
  it("lint rejects an explicit any in core src", async () => {
    const [result] = await eslint.lintText("export const x: any = 1;\n", {
      filePath: "packages/core/src/x.ts",
    });
    expect((result?.messages ?? []).map((m) => m.ruleId)).toContain("@typescript-eslint/no-explicit-any");
  });

  it("production sources contain no lint or type suppressions", () => {
    const offenders = productionSources().filter((file) =>
      /eslint-disable|@ts-ignore|@ts-expect-error|@ts-nocheck/.test(readFileSync(file, "utf8")),
    );
    expect(offenders).toEqual([]);
  });

  it("the suppression scan sees every production file", () => {
    expect(productionSources().length).toBeGreaterThan(15);
  });
});
