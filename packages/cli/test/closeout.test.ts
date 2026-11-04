import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { helpText } from "../src/args.js";
import { EXIT } from "../src/exit-codes.js";

const CLI = resolve(import.meta.dirname, "..");
const pkg = JSON.parse(readFileSync(join(CLI, "package.json"), "utf8")) as {
  bin?: Record<string, string>;
  exports?: Record<string, { types?: string; import?: string }>;
  dependencies?: Record<string, string>;
};

/** `./dist/x.js` -> `src/x.ts`: the source tsc builds the published file from. */
const sourceFor = (published: string) => join(CLI, "src", published.replace(/^\.?\/?dist\//, "").replace(/\.(d\.ts|js)$/, ".ts"));

describe("M3 close-out: package facts", () => {
  it("declares the tempo binary, built from bin.ts", () => {
    expect(pkg.bin).toEqual({ tempo: "dist/bin.js" });
    expect(existsSync(sourceFor("dist/bin.js"))).toBe(true);
    expect(readFileSync(sourceFor("dist/bin.js"), "utf8").startsWith("#!/usr/bin/env node\n")).toBe(true);
  });

  it('exports["."] resolves to files tsc builds', () => {
    const entry = pkg.exports?.["."];
    expect(entry?.import).toBe("./dist/main.js");
    expect(entry?.types).toBe("./dist/main.d.ts");
    expect(existsSync(sourceFor(entry?.import ?? ""))).toBe(true);
    expect(existsSync(sourceFor(entry?.types ?? ""))).toBe(true);
  });

  it("depends on nothing but core at runtime", () => {
    expect(pkg.dependencies).toEqual({ "@marvinliem/tempo-core": "workspace:*" });
  });

  it("--help mentions every exit code", () => {
    for (const code of Object.values(EXIT)) expect(helpText(), `exit ${code}`).toMatch(new RegExp(`^\\s*${code}\\s`, "m"));
  });
});

describe("M3 close-out: only bin.ts touches process", () => {
  const src = join(CLI, "src");
  const files = readdirSync(src).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && f !== "bin.ts");

  it("finds the source files", () => {
    expect(files).toEqual(expect.arrayContaining(["main.ts", "io.ts", "args.ts"]));
  });

  it.each(files)("%s does not use `process`", (file) => {
    const text = readFileSync(join(src, file), "utf8");
    expect(text).not.toMatch(/\bprocess\b/);
    expect(text).not.toContain("node:process");
  });
});
