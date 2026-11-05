import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const read = (rel: string): string => readFileSync(resolve(root, rel), "utf8");

/** Row ids of ASSUMPTIONS.md, in file order. Rows are not contiguous, so callers compare as a set. */
export function assumptionIds(text: string): string[] {
  return [...text.matchAll(/^\| (A-\d\d) \|/gm)].map((m) => m[1] ?? "");
}

/** Every A-nn in `docs` that is not a row id of `ids`: [path, id]. */
export function danglingReferences(docs: Array<{ path: string; text: string }>, ids: Iterable<string>): Array<[string, string]> {
  const known = new Set(ids);
  const out: Array<[string, string]> = [];
  for (const { path, text } of docs) {
    for (const id of new Set(text.match(/\bA-\d\d\b/g) ?? [])) if (!known.has(id)) out.push([path, id]);
  }
  return out;
}

/** Rows whose status cell (the last one) is not one of the closed statuses. */
export function openRows(text: string): string[] {
  const closed = /^(\*\*)?(default|approved|verified|superseded|accepted)\b/i;
  return text
    .split(/\r?\n/)
    .filter((l) => /^\| A-\d\d \|/.test(l))
    .filter((l) => {
      const status = (l.replace(/\|\s*$/, "").split("|").pop() ?? "").trim();
      return !closed.test(status) || /needs approval/i.test(l);
    })
    .map((l) => l.slice(2, 6));
}

const listed = (patterns: string[]): string[] =>
  execFileSync("git", ["ls-files", "-z", "--", ...patterns], { cwd: root, encoding: "utf8" })
    .split("\0")
    .filter((p) => p !== "");

describe("DOC-01: every A-nn referenced in a doc exists in ASSUMPTIONS.md", () => {
  it("flags a reference to a row that does not exist (A-99)", () => {
    expect(danglingReferences([{ path: "fake.md", text: "see A-99 and A-01" }], ["A-01"])).toEqual([["fake.md", "A-99"]]);
  });

  it("assumptionIds reads rows regardless of order", () => {
    expect(assumptionIds("| A-26 | x | y |\n| A-25 | x | y |\n| not a row |")).toEqual(["A-26", "A-25"]);
  });

  it("no root, docs/ or examples/ markdown file references a missing row", () => {
    const files = listed(["*.md", "docs/**/*.md", "examples/**/*.md"]).map((path) => ({ path, text: read(path) }));
    expect(files.length).toBeGreaterThan(8);
    expect(danglingReferences(files, assumptionIds(read("ASSUMPTIONS.md")))).toEqual([]);
  });
});

describe("DOC-04: no ASSUMPTIONS row is open", () => {
  it("openRows flags open and needs-approval rows and accepts the closed statuses", () => {
    const table = [
      "| A-01 | a | b | c | default |",
      "| A-02 | a | b | c | **approved (G25)** |",
      "| A-03 | a | b | c | verified |",
      "| A-04 | a | b | c | superseded by A-09 |",
      "| A-05 | a | b | c | accepted |",
      "| A-06 | a | b | c | open |",
      "| A-07 | Needs approval: x | b | c | default |",
    ].join("\n");
    expect(openRows(table)).toEqual(["A-06", "A-07"]);
  });

  it("every row in ASSUMPTIONS.md has a closed status", () => {
    expect(openRows(read("ASSUMPTIONS.md"))).toEqual([]);
  });
});
