import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

// QG-05 / A-91: fixtures are append-only. The lock maps each fixture's relative POSIX path to the
// lowercase hex SHA-256 of its bytes. This file is also the only writer of fixtures.lock.json.

export const LOCK_NAME = "fixtures.lock.json";

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
  );
}

export function lockFixtures(dir: string): Record<string, string> {
  const entries: [string, string][] = [];
  for (const file of walk(dir)) {
    const rel = relative(dir, file).split(sep).join("/");
    if (!rel.endsWith(".json") || rel === LOCK_NAME) continue;
    const bytes = readFileSync(file);
    if (bytes.includes(0x0d)) throw new Error(`${rel} contains a carriage return (\r); fixtures must use LF line endings`);
    entries.push([rel, createHash("sha256").update(bytes).digest("hex")]);
  }
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return Object.fromEntries(entries);
}

/** Entries of `old` that disappeared or changed in `next`. Additions are never a violation. */
export function appendOnlyViolations(old: Record<string, string>, next: Record<string, string>): string[] {
  const out: string[] = [];
  for (const [rel, hash] of Object.entries(old)) {
    if (!(rel in next)) out.push(`removed: ${rel}`);
    else if (next[rel] !== hash) out.push(`changed: ${rel}`);
  }
  return out;
}

/** A changeset authorises a breaking fixture change when it bumps `pkg` minor (0.x) or major (>= 1.0.0) and has a `BREAKING:` body line. */
export function changesetAuthorizesBreaking(texts: string[], pkg: string, version: string): boolean {
  const bump = Number.parseInt(version.split(".")[0] ?? "0", 10) >= 1 ? "major" : "minor";
  return texts.some((text) => {
    const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(text);
    if (m === null) return false;
    const [, front = "", body = ""] = m;
    const bumps = front.split(/\r?\n/).some((l) => {
      const km = /^\s*["']?([^"':]+)["']?\s*:\s*(\w+)\s*$/.exec(l);
      return km !== null && km[1] === pkg && km[2] === bump;
    });
    return bumps && body.split(/\r?\n/).some((l) => l.startsWith("BREAKING:"));
  });
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const fixtures = resolve(import.meta.dirname, "../fixtures");
  writeFileSync(join(fixtures, LOCK_NAME), `${JSON.stringify(lockFixtures(fixtures), null, 2)}\n`);
}
