import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { evaluate } from "../src/index.js";
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
const run = (f: Fixture) => evaluate(f.input as NegotiationRequest);

// Tier 1: exact. 02:30 on 2025-10-05 exists in Lord_Howe (gap is 02:00-02:30), so EX-16 is a clean book.
const EXACT = [1, 3, 5, 7, 8, 9, 10, 12, 13, 14, 15, 16, 23, 24];
// Tier 2: decision only. NO_SLOTS_IN_HORIZON and DST_RULE_ADJUSTED are M2b (A-52/A-53).
const DECISION = [2, 4, 6, 11, 17, 18, 19, 20, 21];
const M2B = new Set(["NO_SLOTS_IN_HORIZON", "DST_RULE_ADJUSTED"]);

interface Loose {
  ok: boolean;
  decision?: string;
  reasons?: { code: string; participantId?: string }[];
}
function summary(r: unknown) {
  const x = r as Loose;
  return {
    ok: x.ok,
    decision: x.decision,
    reasons: (x.reasons ?? [])
      .filter((q) => !M2B.has(q.code))
      .map((q) => [q.code, q.participantId ?? null]),
  };
}

describe("SPEC worked examples: exact", () => {
  it.each(EXACT.map((n) => [`EX-${String(n).padStart(2, "0")}`, n] as const))("%s", (_id, n) => {
    const f = load(n);
    expect(run(f)).toEqual(f.expected);
  });
});

describe("SPEC worked examples: decision and reasons (M2b codes removed)", () => {
  it.each(DECISION.map((n) => [`EX-${String(n).padStart(2, "0")}`, n] as const))("%s", (_id, n) => {
    const f = load(n);
    expect(summary(run(f))).toEqual(summary(f.expected));
  });
});

describe("SPEC worked examples: deferred to M2b", () => {
  it.todo("EX-22 explain trace (M2b)");
});
