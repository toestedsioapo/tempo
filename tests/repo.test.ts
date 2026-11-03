import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");

function readText(rel: string): string {
  return readFileSync(resolve(root, rel), "utf8");
}

function readJson(rel: string): unknown {
  return JSON.parse(readText(rel));
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function rootPackage(): Record<string, unknown> {
  const pkg = readJson("package.json");
  if (!isRecord(pkg)) throw new Error("package.json is not an object");
  return pkg;
}

describe("repo config", () => {
  it("CFG-01: package.json does not mention shared-ui", () => {
    expect(readText("package.json")).not.toContain("shared-ui");
  });

  it("CFG-02: root package.json has no workspaces key", () => {
    expect(rootPackage()).not.toHaveProperty("workspaces");
  });

  it("CFG-03: packageManager is pinned to pnpm 12.15.x", () => {
    expect(rootPackage()["packageManager"]).toMatch(/^pnpm@12\.15\.\d+$/);
  });

  it("CFG-04: engines.node is >=24", () => {
    const engines = rootPackage()["engines"];
    expect(isRecord(engines) ? engines["node"] : undefined).toBe(">=24");
  });

  it("CFG-05: required scripts exist and test does not pass with no tests", () => {
    const scripts = rootPackage()["scripts"];
    if (!isRecord(scripts)) throw new Error("scripts missing");
    for (const name of ["build", "typecheck", "lint", "test"]) {
      expect(scripts).toHaveProperty(name);
    }
    expect(String(scripts["test"])).not.toContain("passWithNoTests");
  });

  it("CFG-06: pnpm-workspace.yaml packages are exactly packages/*", () => {
    const lines = readText("pnpm-workspace.yaml").split(/\r?\n/);
    const start = lines.findIndex((l) => /^packages:\s*$/.test(l));
    expect(start).toBeGreaterThanOrEqual(0);
    const entries: string[] = [];
    for (const line of lines.slice(start + 1)) {
      const m = /^\s+-\s+['"]?([^'"\s]+)['"]?\s*$/.exec(line);
      if (!m) break;
      entries.push(m[1] as string);
    }
    expect(entries).toEqual(["packages/*"]);
  });
});
