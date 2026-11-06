import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const read = (rel: string): string => readFileSync(resolve(root, rel), "utf8").replaceAll("\r\n", "\n");

type Json = Record<string, unknown>;
const isRecord = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

function version(dir: string): unknown {
  const pkg: unknown = JSON.parse(read(`${dir}/package.json`));
  return isRecord(pkg) ? pkg["version"] : undefined;
}

/**
 * The release run (A-95) commits the bump and the CHANGELOGs. Until then `main` is "pre-release":
 * manifests at 0.0.0 and the changeset pending. After it, packages/cli/CHANGELOG.md exists.
 */
const released = existsSync(resolve(root, "packages/cli/CHANGELOG.md"));

describe("A-93: both packages release as exactly 0.1.0", () => {
  it("both manifests are at 0.0.0 until the release run versions them (A-95), and at 0.1.0 after", () => {
    const want = released ? "0.1.0" : "0.0.0";
    expect(version("packages/core")).toBe(want);
    expect(version("packages/cli")).toBe(want);
  });

  it.runIf(released)("after the release both CHANGELOGs have a 0.1.0 section", () => {
    expect(read("packages/core/CHANGELOG.md")).toContain("## 0.1.0");
    expect(read("packages/cli/CHANGELOG.md")).toContain("## 0.1.0");
  });

  it.skipIf(released)("one changeset names both packages with a minor bump", () => {
    const text = read(".changeset/initial-release.md");
    expect(text).toMatch(/^---\n"@marvinliem\/tempo-core": minor\n"@marvinliem\/tempo": minor\n---\n/);
    expect(text).toContain("Initial release.");
  });

  it.skipIf(released)("changeset status would release 0.1.0 for both packages and nothing else (Review Focus 7)", () => {
    const dir = mkdtempSync(join(tmpdir(), "tempo-status-"));
    const out = join(dir, "status.json");
    try {
      execFileSync("pnpm", ["changeset", "status", "--output", out], {
        cwd: root,
        encoding: "utf8",
        shell: process.platform === "win32",
      });
      const plan: unknown = JSON.parse(readFileSync(out, "utf8"));
      const releases = isRecord(plan) && Array.isArray(plan["releases"]) ? plan["releases"] : [];
      const summary = releases
        .map((r) => (isRecord(r) ? [r["name"], r["type"], r["oldVersion"], r["newVersion"]] : []))
        .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
      expect(summary).toEqual([
        ["@marvinliem/tempo", "minor", "0.0.0", "0.1.0"],
        ["@marvinliem/tempo-core", "minor", "0.0.0", "0.1.0"],
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it("A-93, A-94 and A-95 exist in ASSUMPTIONS.md", () => {
    const text = read("ASSUMPTIONS.md");
    for (const id of ["A-93", "A-94", "A-95"]) expect(text).toContain(`| ${id} |`);
  });
});
