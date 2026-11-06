import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const REPO = "https://github.com/toestedsioapo/tempo";

type Json = Record<string, unknown>;

function isRecord(v: unknown): v is Json {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function manifest(dir: string): Json {
  const raw: unknown = JSON.parse(readFileSync(resolve(root, dir, "package.json"), "utf8"));
  if (!isRecord(raw)) throw new Error(`${dir}/package.json is not an object`);
  return raw;
}

const packages = [
  { dir: "packages/core", name: "@marvinliem/tempo-core" },
  { dir: "packages/cli", name: "@marvinliem/tempo" },
] as const;

describe.each(packages)("package metadata: $name", ({ dir, name }) => {
  const pkg = manifest(dir);

  it("is publishable, MIT, public, with provenance", () => {
    expect(pkg["name"]).toBe(name);
    expect(pkg).not.toHaveProperty("private");
    expect(pkg["license"]).toBe("MIT");
    expect(pkg["publishConfig"]).toEqual({ access: "public", provenance: true });
    expect(isRecord(pkg["engines"]) ? pkg["engines"]["node"] : undefined).toBe(">=24");
  });

  it("repository matches the trusted publisher's repo exactly", () => {
    expect(pkg["repository"]).toEqual({
      type: "git",
      url: "git+https://github.com/toestedsioapo/tempo.git",
      directory: dir,
    });
  });

  it("has homepage, bugs, description, keywords and a README", () => {
    expect(String(pkg["homepage"])).toMatch(new RegExp(`^${REPO}`));
    const bugs = pkg["bugs"];
    expect(String(isRecord(bugs) ? bugs["url"] : "")).toMatch(new RegExp(`^${REPO}`));
    expect(String(pkg["description"] ?? "").length).toBeGreaterThan(10);
    expect(Array.isArray(pkg["keywords"]) && pkg["keywords"].length > 0).toBe(true);
    expect(existsSync(resolve(root, dir, "README.md"))).toBe(true);
  });
});

describe("cli manifest", () => {
  const cli = manifest("packages/cli");
  it("has the tempo bin and depends on core through the workspace", () => {
    expect(isRecord(cli["bin"]) ? cli["bin"]["tempo"] : undefined).toBe("dist/bin.js");
    const deps = cli["dependencies"];
    expect(isRecord(deps) ? deps["@marvinliem/tempo-core"] : undefined).toBe("workspace:*");
  });
});

// --- packed tarballs (Review Focus 2 and 3) ---------------------------------------------------

const packRoot = mkdtempSync(join(tmpdir(), "tempo-pack-"));
afterAll(() => rmSync(packRoot, { recursive: true, force: true }));

function pnpm(args: string[], cwd: string): string {
  return execFileSync("pnpm", args, { cwd, encoding: "utf8", shell: process.platform === "win32" });
}

/** Packs `dir` and returns the tarball's file list and its package.json. */
function pack(dir: string): { files: string[]; manifest: Json } {
  const out = join(packRoot, dir.replace(/\W/g, "_"));
  pnpm(["pack", "--pack-destination", out], resolve(root, dir));
  const tgz = readdirSync(out).find((f) => f.endsWith(".tgz"));
  if (tgz === undefined) throw new Error(`no tarball produced for ${dir}`);
  // Run tar inside the directory with a bare file name: GNU tar reads "C:" in an absolute path as a host.
  const tar = (...args: string[]): string => execFileSync("tar", args, { cwd: out, encoding: "utf8" });
  const files = tar("-tzf", tgz)
    .split(/\r?\n/)
    .filter((l) => l !== "")
    .map((l) => l.replace(/^package\//, ""));
  const text = tar("-xOzf", tgz, "package/package.json");
  const parsed: unknown = JSON.parse(text);
  if (!isRecord(parsed)) throw new Error("packed package.json is not an object");
  return { files, manifest: parsed };
}

describe("packed tarballs", () => {
  const core = manifest("packages/core");
  const coreVersion = String(core["version"]);

  it("core ships dist, schema and fixtures, and no sources, tests or scripts", () => {
    const { files } = pack("packages/core");
    for (const want of ["dist/index.js", "schema/rules.schema.json", "fixtures/fixtures.lock.json", "package.json", "README.md"]) {
      expect(files, want).toContain(want);
    }
    const bad = files.filter((f) => /^(src|test|scripts)\//.test(f) || /\.test\./.test(f) || /^tsconfig/.test(f));
    expect(bad).toEqual([]);
  }, 120_000);

  it("cli ships a bin and dist only, and depends on core by a real range, not workspace:", () => {
    const { files, manifest: packed } = pack("packages/cli");
    expect(files).toContain("dist/bin.js");
    expect(files).toContain("README.md");
    const bad = files.filter((f) => /^(src|test)\//.test(f) || /\.test\./.test(f) || /^tsconfig/.test(f));
    expect(bad).toEqual([]);
    const deps = packed["dependencies"];
    const range = String(isRecord(deps) ? deps["@marvinliem/tempo-core"] : "");
    expect(range).not.toContain("workspace:");
    // pnpm rewrites `workspace:*` to core's exact version at pack time.
    expect(range).toBe(coreVersion);
    expect(readFileSync(resolve(root, "packages/cli/dist/bin.js"), "utf8").startsWith("#!/usr/bin/env node")).toBe(true);
  }, 120_000);
});
