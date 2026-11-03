import { readdirSync, readFileSync } from "node:fs";
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

  it("CFG-07: core dependencies are exactly luxon and zod", () => {
    const pkg = readJson("packages/core/package.json");
    const deps = isRecord(pkg) ? pkg["dependencies"] : undefined;
    expect(Object.keys(isRecord(deps) ? deps : {}).sort()).toEqual(["luxon", "zod"]);
  });

  it("CFG-07: core src never uses Temporal outside comments", () => {
    const offenders: string[] = [];
    for (const file of walk("packages/core/src")) {
      if (!/\.(ts|js|mjs|cjs)$/.test(file)) continue;
      const code = stripComments(readText(file));
      if (/\bTemporal\b/.test(code)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it("CFG-08: no dts.ts anywhere under packages/", () => {
    const found = walk("packages").filter((f) => f.split("/").pop() === "dts.ts");
    expect(found).toEqual([]);
  });
  it.todo("dst.ts exists in core (M2b)");
  it.todo("SKILL.md exists at the repo root (M4)");

  it("licence: LICENSE is MIT with Marvin Liemor as holder", () => {
    const text = readText("LICENSE");
    expect(text.startsWith("MIT License")).toBe(true);
    expect(text).toMatch(/^Copyright \(c\) .*Marvin Liemor/m);
  });

  it("licence: both packages declare MIT and the author", () => {
    for (const rel of ["packages/core/package.json", "packages/cli/package.json"]) {
      const pkg = readJson(rel);
      expect(isRecord(pkg) ? pkg["license"] : undefined).toBe("MIT");
      expect(isRecord(pkg) ? pkg["author"] : undefined).toBe("Marvin Liemor");
    }
  });

  it("CFG-11: changesets config is public", () => {
    const cfg = readJson(".changeset/config.json");
    expect(isRecord(cfg) ? cfg["access"] : undefined).toBe("public");
  });

  it("CFG-11: release workflow uses provenance and holds no token", () => {
    const release = readText(".github/workflows/release.yml");
    expect(release).toContain("id-token: write");
    expect(release).toContain("provenance");
    const tokenPattern = /NPM_TOKEN|NODE_AUTH_TOKEN|_authToken/;
    expect(release).not.toMatch(tokenPattern);
    expect(readText(".github/workflows/ci.yml")).not.toMatch(tokenPattern);
  });

  it("coverage: script, provider dependency, no thresholds, ignored output", () => {
    const pkg = rootPackage();
    const scripts = pkg["scripts"];
    expect(isRecord(scripts) ? scripts["test:coverage"] : undefined).toBeTypeOf("string");
    const dev = pkg["devDependencies"];
    expect(isRecord(dev) ? dev["@vitest/coverage-v8"] : undefined).toBeTypeOf("string");
    expect(readText("vitest.config.ts")).not.toContain("thresholds");
    const lines = readText(".gitignore").split(/\r?\n/).map((l) => l.trim());
    expect(lines).toContain("coverage/");
  });

  it("coverage: core config gates lines and branches at 95 (A-58)", () => {
    const cfg = readText("packages/core/vitest.config.ts");
    expect(cfg).toContain("thresholds");
    expect(cfg).toMatch(/lines:\s*95/);
    expect(cfg).toMatch(/branches:\s*95/);
  });

  describe("CI workflow", () => {
    const ci = (): string => readText(".github/workflows/ci.yml");
    const runLines = (): string[] =>
      ci()
        .split(/\r?\n/)
        .map((l) => l.trim().replace(/^- /, ""))
        .filter((l) => l.startsWith("run:"));

    it("CI: ci.yml exists and covers the OS and Node matrix", () => {
      const text = ci();
      expect(text).toContain("ubuntu-latest");
      expect(text).toContain("windows-latest");
      expect(text).toMatch(/node:\s*\[\s*24\s*,\s*26\s*\]/);
      expect(text).toContain("--frozen-lockfile");
    });

    it("CI: runs install, typecheck, lint, test, build in order (whole run lines)", () => {
      const runs = runLines();
      const order = [
        "run: pnpm install --frozen-lockfile",
        "run: pnpm typecheck",
        "run: pnpm lint",
        "run: pnpm test",
        "run: pnpm build",
      ].map((cmd) => runs.indexOf(cmd));
      expect(order.every((i) => i >= 0)).toBe(true);
      expect(order).toEqual([...order].sort((a, b) => a - b));
    });

    it("CI: coverage runs after test and before build, and is uploaded", () => {
      const runs = runLines();
      const test = runs.indexOf("run: pnpm test");
      const cov = runs.indexOf("run: pnpm test:coverage");
      const build = runs.indexOf("run: pnpm build");
      expect(cov).toBeGreaterThan(test);
      expect(cov).toBeLessThan(build);
      const text = ci();
      expect(text).toContain("actions/upload-artifact");
      expect(text).toMatch(/^\s*path:[\s\S]*?coverage\//m);
      expect(text).toContain("if-no-files-found: error");
    });

    it("CI: fail-fast is off and permissions are read-only", () => {
      const text = ci();
      expect(text).toContain("fail-fast: false");
      expect(text).toContain("contents: read");
    });

    it("CI: holds no token pattern", () => {
      expect(ci()).not.toMatch(/NPM_TOKEN|NODE_AUTH_TOKEN|_authToken|secrets\./);
    });
  });
});

function walk(rel: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(resolve(root, rel), { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist") continue;
    const child = rel + "/" + entry.name;
    if (entry.isDirectory()) out.push(...walk(child));
    else out.push(child);
  }
  return out;
}

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}
