import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { evaluate, explain } from "../src/index.js";
import type { NegotiationRequest } from "../src/index.js";

const fixturesDir = resolve(import.meta.dirname, "../fixtures/examples");

interface Fixture {
  id: string;
  entry: "evaluate" | "explain";
  input: unknown;
  expected: unknown;
}
const load = (n: number): Fixture =>
  JSON.parse(readFileSync(join(fixturesDir, `ex-${String(n).padStart(2, "0")}.json`), "utf8")) as Fixture;
const run = (f: Fixture) => (f.entry === "explain" ? explain : evaluate)(f.input as NegotiationRequest);

// Byte-exact against the fixture. 02:30 on 2025-10-05 exists in Lord_Howe (gap is 02:00-02:30), so EX-16 is a clean book.
const EXACT = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24];

describe("SPEC worked examples: exact", () => {
  it.each(EXACT.map((n) => [`EX-${String(n).padStart(2, "0")}`, n] as const))("%s", (_id, n) => {
    const f = load(n);
    expect(run(f)).toEqual(f.expected);
  });
});
