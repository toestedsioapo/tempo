import { readdirSync, readFileSync } from "node:fs";
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
    ["DateTime.now()", 'import { DateTime } from "luxon";\nexport const z = DateTime.now();', "no-restricted-syntax"],
    ["DateTime.local()", 'import { DateTime } from "luxon";\nexport const z = DateTime.local();', "no-restricted-syntax"],
    ["DateTime.utc()", 'import { DateTime } from "luxon";\nexport const z = DateTime.utc();', "no-restricted-syntax"],
    ["crypto.randomUUID()", "export const z = crypto.randomUUID();", "no-restricted-globals"],
    ["performance.now()", "export const z = performance.now();", "no-restricted-globals"],
  ])("rejects %s in core src", async (_name, code, rule) => {
    expect(await ruleIds(code)).toContain(rule);
  });

  it.each([
    [
      "DateTime.fromISO with explicit zone",
      'import { DateTime } from "luxon";\nexport const z = DateTime.fromISO("2025-01-01T00:00:00Z", { zone: "utc" });\n',
    ],
    ["DateTime.utc with explicit args", 'import { DateTime } from "luxon";\nexport const z = DateTime.utc(2025, 1, 1);\n'],
    [
      "DateTime.fromISO(s, { zone: utc })",
      'import { DateTime } from "luxon";\nexport const f = (s: string) => DateTime.fromISO(s, { zone: "utc" });\n',
    ],
  ])("accepts luxon usage: %s", async (_name, code) => {
    expect(await ruleIds(code)).toEqual([]);
  });

  it("still bans the Luxon clock in test files", async () => {
    const code = 'import { DateTime } from "luxon";\nexport const z = DateTime.now();\n';
    expect(await ruleIds(code, "packages/core/src/x.test.ts")).toContain("no-restricted-syntax");
  });

  it("still bans crypto and performance in test files", async () => {
    expect(await ruleIds("performance.now();", "packages/core/src/x.test.ts")).toContain("no-restricted-globals");
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

// CORE-40: source scan. Comments are stripped with a regex, so a banned token inside a
// string literal that contains "//" could be missed; the lint rules above are the primary guard.
const BANNED = [
  /Date\.now/,
  /new Date/,
  /Math\.random/,
  /process\./,
  /globalThis\.process/,
  /node:fs/,
  /from\s+["']fs["']/,
  /require\(\s*["'](node:)?fs["']\s*\)/,
];

function scanSource(label: string, src: string): string[] {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const found: string[] = [];
  code.split(/\r?\n/).forEach((line, i) => {
    if (BANNED.some((re) => re.test(line))) found.push(`${label}:${i + 1}: ${line.trim()}`);
  });
  return found;
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = resolve(dir, e.name);
    if (e.isDirectory()) return sourceFiles(full);
    return e.name.endsWith(".ts") && !e.name.endsWith(".test.ts") ? [full] : [];
  });
}

describe("core purity source scan (CORE-40)", () => {
  const srcDir = resolve(repoRoot, "packages/core/src");

  it("no non-test source line uses the clock, randomness, process or fs", () => {
    const files = sourceFiles(srcDir);
    expect(files.length).toBeGreaterThan(5);
    const offenders = files.flatMap((f) => scanSource(f, readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });

  it("the scanner flags a planted offender but not one inside a comment", () => {
    expect(scanSource("x", "const t = Date.now();")).toHaveLength(1);
    expect(scanSource("x", "const r = Math.random();")).toHaveLength(1);
    expect(scanSource("x", "import fs from 'fs';")).toHaveLength(1);
    expect(scanSource("x", 'const fs = require("fs");')).toHaveLength(1);
    expect(scanSource("x", "const p = globalThis.process;")).toHaveLength(1);
    expect(scanSource("x", "// Date.now() is banned\n/* new Date() */\nconst a = 1;")).toEqual([]);
  });
});
