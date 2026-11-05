import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { appendOnlyViolations, changesetAuthorizesBreaking, lockFixtures } from "../scripts/lock-fixtures.js";

const coreDir = resolve(import.meta.dirname, "..");
const fixturesDir = join(coreDir, "fixtures");
const lockPath = join(fixturesDir, "fixtures.lock.json");
const committed = (): Record<string, string> => JSON.parse(readFileSync(lockPath, "utf8")) as Record<string, string>;

describe("QG-05: fixtures.lock.json (A-91)", () => {
  it("every fixture has a lock entry and its hash matches", () => {
    expect(lockFixtures(fixturesDir)).toEqual(committed());
  });

  it("the lock has no entry for a missing file", () => {
    for (const rel of Object.keys(committed())) expect(existsSync(join(fixturesDir, rel))).toBe(true);
  });

  it("lock keys are relative POSIX paths and values are lowercase hex SHA-256", () => {
    for (const [rel, hash] of Object.entries(committed())) {
      expect(rel).toMatch(/^(examples|dst)\/[a-z0-9-]+\.json$/);
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("lockFixtures throws on a file containing a carriage return", () => {
    const dir = mkdtempSync(join(tmpdir(), "tempo-lock-"));
    try {
      writeFileSync(join(dir, "a.json"), '{"a":1}\r\n');
      expect(() => lockFixtures(dir)).toThrow(/\r|carriage/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("lockFixtures ignores the lock file itself and sorts keys", () => {
    const dir = mkdtempSync(join(tmpdir(), "tempo-lock-"));
    try {
      writeFileSync(join(dir, "b.json"), "{}\n");
      writeFileSync(join(dir, "a.json"), "[]\n");
      writeFileSync(join(dir, "fixtures.lock.json"), "{}\n");
      expect(Object.keys(lockFixtures(dir))).toEqual(["a.json", "b.json"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("QG-05: append-only rule", () => {
  const h = (c: string): string => c.repeat(64);
  const old = { "examples/ex-01.json": h("a"), "examples/ex-02.json": h("b") };

  it("a pure addition is not a violation", () => {
    expect(appendOnlyViolations(old, { ...old, "dst/dst-01.json": h("c") })).toEqual([]);
  });

  it("a removed entry is a violation", () => {
    expect(appendOnlyViolations(old, { "examples/ex-01.json": h("a") })).toEqual(["removed: examples/ex-02.json"]);
  });

  it("a changed entry is a violation", () => {
    expect(appendOnlyViolations(old, { ...old, "examples/ex-01.json": h("d") })).toEqual(["changed: examples/ex-01.json"]);
  });

  const pkg = "@marvinliem/tempo-core";
  it("a breaking changeset must name core with minor on 0.x and start a body line with BREAKING:", () => {
    const ok = `---\n"${pkg}": minor\n---\n\nBREAKING: ex-01 changed.\n`;
    expect(changesetAuthorizesBreaking([ok], pkg, "0.1.0")).toBe(true);
    expect(changesetAuthorizesBreaking([ok.replace("minor", "patch")], pkg, "0.1.0")).toBe(false);
    expect(changesetAuthorizesBreaking([ok.replace("BREAKING:", "Note:")], pkg, "0.1.0")).toBe(false);
    expect(changesetAuthorizesBreaking([ok.replace(pkg, "other")], pkg, "0.1.0")).toBe(false);
    expect(changesetAuthorizesBreaking([], pkg, "0.1.0")).toBe(false);
  });

  it("from 1.0.0 the bump must be major", () => {
    const minor = `---\n"${pkg}": minor\n---\n\nBREAKING: x\n`;
    expect(changesetAuthorizesBreaking([minor], pkg, "1.0.0")).toBe(false);
    expect(changesetAuthorizesBreaking([minor.replace("minor", "major")], pkg, "1.0.0")).toBe(true);
  });

  // Thin git read: skipped when origin/main (or the file on it) is absent.
  const baseLock = ((): Record<string, string> | undefined => {
    try {
      const text = execFileSync("git", ["show", "origin/main:packages/core/fixtures/fixtures.lock.json"], {
        cwd: coreDir,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      return JSON.parse(text) as Record<string, string>;
    } catch {
      return undefined;
    }
  })();

  it.skipIf(baseLock === undefined)("this branch only appends to origin/main's lock, or ships a BREAKING changeset", () => {
    const violations = appendOnlyViolations(baseLock!, committed());
    if (violations.length === 0) return;
    const dir = resolve(coreDir, "../../.changeset");
    const texts = execFileSync("git", ["ls-files", "-z", "--", ".changeset/*.md"], { cwd: resolve(coreDir, "../.."), encoding: "utf8" })
      .split("\0")
      .filter((f) => f !== "" && !f.endsWith("README.md"))
      .map((f) => readFileSync(join(dir, "..", f), "utf8"));
    expect(changesetAuthorizesBreaking(texts, "@marvinliem/tempo-core", "0.1.0"), violations.join(", ")).toBe(true);
  });
});
