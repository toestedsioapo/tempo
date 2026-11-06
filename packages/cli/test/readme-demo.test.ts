import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { main } from "../src/main.js";
import { fakeEnv } from "./env.js";

const repoRoot = resolve(import.meta.dirname, "../../..");
const text = (rel: string): string => readFileSync(resolve(repoRoot, rel), "utf8").replaceAll("\r\n", "\n");
const readme = text("README.md");
const FENCE = "`".repeat(3);

/** Fenced blocks of one language that follow `heading`, in order. */
function blocksAfter(src: string, heading: string, lang: string): string[] {
  const from = src.indexOf(heading);
  if (from < 0) throw new Error(`README has no heading ${heading}`);
  const rest = src.slice(from + heading.length);
  const next = rest.search(/\n## /);
  const section = next < 0 ? rest : rest.slice(0, next);
  return section
    .split(FENCE + lang + "\n")
    .slice(1)
    .map((c) => c.split(FENCE)[0]!);
}

const DEMO_HEADING = "## Demo: `tempo explain`";

describe("CLI-19 / DOC-03: the README demo is reproducible (F21)", () => {
  const [input, output] = blocksAfter(readme, DEMO_HEADING, "json") as [string, string];

  it("the README input block equals examples/demo.json byte for byte", () => {
    expect(input).toBe(text("examples/demo.json"));
  });

  it("explain --json on it reproduces the README output block", async () => {
    const env = fakeEnv({ files: { "demo.json": input } });
    expect(await main(["explain", "demo.json", "--json"], env)).toBe(0);
    expect(JSON.parse(env.out.join(""))).toEqual(JSON.parse(output));
  });

  it("the README output block equals examples/demo.explain.json semantically, and the file is the CLI's exact stdout", async () => {
    expect(JSON.parse(output)).toEqual(JSON.parse(text("examples/demo.explain.json")));
    const env = fakeEnv({ files: { "demo.json": input } });
    await main(["explain", "demo.json", "--json"], env);
    expect(text("examples/demo.explain.json")).toBe(env.out.join(""));
  });

  it("the exit code stated for the demo is right: 0, or 1 with --exit-code", async () => {
    const plain = fakeEnv({ files: { "demo.json": input } });
    const flagged = fakeEnv({ files: { "demo.json": input } });
    expect(await main(["explain", "demo.json", "--json"], plain)).toBe(0);
    expect(await main(["explain", "demo.json", "--json", "--exit-code"], flagged)).toBe(1);
  });
});

describe("DOC-03: README commands are copy-pasteable", () => {
  const commands = ["bash", "powershell"].flatMap((lang) =>
    [...readme.split(FENCE + lang + "\n").slice(1)]
      .map((c) => c.split(FENCE)[0]!)
      .flatMap((b) => b.split("\n"))
      .map((l) => l.trim())
      .filter((l) => l !== "" && !l.startsWith("#")),
  );
  const ALLOWED = /^(tempo |node packages\/cli\/dist\/bin\.js |pnpm |npm |npx |Get-Content |cmd \/c |\$OutputEncoding)/;

  it("has commands to check", () => {
    expect(commands.length).toBeGreaterThan(5);
  });

  it("every command starts with a known program", () => {
    for (const c of commands) expect(c, c).toMatch(ALLOWED);
  });

  it("no command uses a line continuation (backslash or backtick at the end)", () => {
    for (const c of commands) expect(c, c).not.toMatch(/[\\`]$/);
  });

  it("every examples/ file a command names exists", () => {
    for (const c of commands) {
      for (const m of c.matchAll(/examples\/[\w./-]+\.json/g)) expect(existsSync(resolve(repoRoot, m[0])), c).toBe(true);
    }
  });

  it("the clone quick start runs the built binary on the demo file", () => {
    expect(commands).toContain("node packages/cli/dist/bin.js explain examples/demo.json --json");
  });

  it("carries the PowerShell 5.1 piping warning with the working alternatives", () => {
    const piped = commands.filter((c) => /Get-Content .*Encoding UTF8.*\|/.test(c));
    expect(piped.length).toBeGreaterThan(0);
    for (const c of piped) expect(c, c).toContain("$OutputEncoding");
    expect(readme).toMatch(/PowerShell 5\.1/);
  });

  it("links SKILL.md, examples/ and examples/n8n/, and every relative link resolves", () => {
    expect(readme).toContain("(./SKILL.md)");
    expect(readme).toContain("(./examples/)");
    expect(readme).toContain("(./examples/n8n/)");
    for (const m of readme.matchAll(/\]\((\.\/[^)#]+)(?:#[^)]*)?\)/g)) {
      expect(existsSync(resolve(repoRoot, dirname("README.md"), m[1]!)), m[1]).toBe(true);
    }
  });

  it("no longer says implementation has not started", () => {
    expect(readme).not.toMatch(/planning approved|the engine is not|implementation starting/i);
  });
});
