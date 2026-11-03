import { resolve } from "node:path";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(import.meta.dirname, "../../..");
const eslint = new ESLint({ cwd: repoRoot });

async function ruleIds(code: string, filePath = "packages/core/src/x.ts"): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? []).map((m) => m.ruleId ?? `fatal:${m.message}`);
}

describe("core purity lint rules", () => {
  it.each([
    ["Date.now()", "const t = Date.now();", "no-restricted-syntax"],
    ["new Date()", "const d = new Date();", "no-restricted-syntax"],
    ["Math.random()", "Math.random();", "no-restricted-syntax"],
    ["process", "process.env.X;", "no-restricted-globals"],
    ["node:fs import", 'import fs from "node:fs";\nexport default fs;', "no-restricted-imports"],
    ["Temporal", "Temporal.Now.instant();", "no-restricted-globals"],
  ])("rejects %s in core src", async (_name, code, rule) => {
    expect(await ruleIds(code)).toContain(rule);
  });

  it("accepts luxon usage", async () => {
    const code = 'import { DateTime } from "luxon";\nexport const z = DateTime.utc();\n';
    expect(await ruleIds(code)).toEqual([]);
  });

  it("allows node imports in test files", async () => {
    const code = 'import fs from "node:fs";\nexport default fs;\n';
    expect(await ruleIds(code, "packages/core/src/x.test.ts")).toEqual([]);
  });

  it("still bans Date in test files", async () => {
    expect(await ruleIds("const t = Date.now();", "packages/core/src/x.test.ts")).toContain(
      "no-restricted-syntax",
    );
  });
});
