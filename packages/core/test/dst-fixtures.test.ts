import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { evaluate } from "../src/index.js";
import type { NegotiationRequest } from "../src/index.js";
import { oracleSlots } from "./oracle/oracle.js";
import type { OracleInput } from "./oracle/oracle.js";

// A-92: named DST fixtures. Expected values were derived by hand (the arithmetic is in docs/reviews/m5-docs-match.md) and are checked against BOTH the engine and the independent oracle (A-64, ORC-02).
const dir = resolve(import.meta.dirname, "../fixtures/dst");
interface Fixture {
  id: string;
  input: unknown;
  expected: { ok: true; decision: string; reasons: { code: string; participantId?: string }[]; slots: unknown[] };
}
const files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
const load = (f: string): Fixture => JSON.parse(readFileSync(join(dir, f), "utf8")) as Fixture;

describe("fixtures/dst (A-92)", () => {
  it("has the two named cells, append-only numbering", () => {
    expect(files).toEqual(["dst-01.json", "dst-02.json"]);
  });

  it.each(files)("%s: engine output equals the hand-derived expectation", (f) => {
    const fx = load(f);
    expect(evaluate(fx.input as NegotiationRequest)).toEqual(fx.expected);
  });

  it.each(files)("%s: the independent oracle agrees on decision, failing parties and gate", (f) => {
    const fx = load(f);
    const r = oracleSlots(fx.input as OracleInput);
    if ("error" in r) throw new Error("unexpected oracle error");
    expect({ decision: r.decision, failing: r.failing, gate: r.gate }).toEqual({
      decision: fx.expected.decision,
      failing: fx.expected.reasons.filter((x) => x.code === "OUTSIDE_AVAILABILITY" || x.code === "IN_BLACKOUT").map((x) => x.participantId),
      gate: "OK",
    });
  });
});
