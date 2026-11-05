import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { main } from "../src/main.js";
import { EXIT } from "../src/exit-codes.js";
import { fakeEnv } from "./env.js";

const repoRoot = resolve(import.meta.dirname, "../../..");
const skill = readFileSync(resolve(repoRoot, "SKILL.md"), "utf8").replaceAll("\r\n", "\n");

/** Fenced blocks of one language, in order. */
function blocks(text: string, lang: string): string[] {
  const fence = "`".repeat(3);
  return text
    .split(fence + lang + "\n")
    .slice(1)
    .map((chunk) => chunk.split(fence)[0]!);
}

// One example per line: [cat FILE | | echo 'TEXT' | ]tempo ARGS [< FILE]   # exit: N
const LINE = /^(?:cat (\S+) \| |echo '(.*)' \| )?tempo (.+?)(?: < (\S+))?\s+# exit: (\d)$/;
interface Example {
  line: string;
  args: string[];
  file: string | undefined;
  literal: string | undefined;
  exit: number;
}
const examples: Example[] = blocks(skill, "bash").flatMap((b) =>
  b
    .split("\n")
    .filter((l) => l.trim() !== "" && !l.trim().startsWith("#"))
    .map((line) => {
      const m = LINE.exec(line.trim());
      if (!m) throw new Error(`SKILL.md example does not parse: ${line}`);
      return { line, args: m[3]!.split(/\s+/), file: m[1] ?? m[4], literal: m[2], exit: Number(m[5]) };
    }),
);

describe("SKILL.md (CFG-08, CFG-09, D16)", () => {
  it("CFG-08: exists at the repo root and not under .claude/", () => {
    expect(existsSync(resolve(repoRoot, "SKILL.md"))).toBe(true);
    expect(existsSync(resolve(repoRoot, ".claude", "SKILL.md"))).toBe(false);
  });

  it("CFG-09: has at least one example per command and one for each of exit 0, 1, 2 and 3", () => {
    for (const c of ["check", "suggest", "explain"]) expect(examples.some((e) => e.args[0] === c), c).toBe(true);
    for (const code of [0, 1, 2, 3]) expect(examples.some((e) => e.exit === code), `exit ${code}`).toBe(true);
  });

  it("CFG-09: every file an example names exists", () => {
    for (const e of examples) {
      const files = [e.file, ...e.args.filter((a) => a.startsWith("examples/"))].filter((f): f is string => f !== undefined);
      for (const f of files) expect(existsSync(resolve(repoRoot, f)), `${e.line} -> ${f}`).toBe(true);
    }
  });

  it.each(examples.map((e) => [e.line, e] as const))("CFG-09: documented exit code matches: %s", async (_line, e) => {
    const positional = e.args.find((a) => a.startsWith("examples/"));
    const files: Record<string, Uint8Array> = {};
    const path = e.file ?? positional;
    if (path !== undefined) files[path] = readFileSync(resolve(repoRoot, path));
    const stdinBytes = e.literal !== undefined ? new TextEncoder().encode(e.literal) : e.file !== undefined && positional === undefined ? files[e.file] : undefined;
    const env = fakeEnv({ files, ...(stdinBytes ? { stdin: stdinBytes } : {}) });
    expect(await main(e.args, env)).toBe(e.exit);
  });

  it("lists every exit code of D14", () => {
    for (const code of Object.values(EXIT)) {
      expect(skill, `exit ${code}`).toContain(`| \`${code}\` |`);
    }
  });

  it("carries the PowerShell 5.1 note with the working alternatives", () => {
    expect(skill).toContain("Get-Content -Encoding UTF8");
    expect(skill).toContain("$OutputEncoding");
    expect(skill).toMatch(/PowerShell 5\.1/);
    expect(skill).toContain("Zo??");
  });

  it("is ASCII-only outside code fences, apart from the Zoe example", () => {
    const prose = skill.replace(/```[\s\S]*?```/g, "").replace(/Zoë|ZoÃ«/g, "Zoe");
    expect(prose).toMatch(/^[\n -~]*$/);
  });

  it("says never to guess an ambiguous zone and never to parse human output", () => {
    expect(skill).toMatch(/never guess/i);
    expect(skill).toMatch(/human-readable/i);
  });
});
