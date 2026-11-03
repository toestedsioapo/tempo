// ORC-01 (decision only): the engine and the independent oracle agree on generated inputs.
// Inputs stay more than one day away from every DST transition of every zone involved, because
// the oracle does not model the A-07 rule-boundary policy (see oracle.ts header, A-55).
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { evaluate } from "../../src/index.js";
import type { NegotiationRequest } from "../../src/index.js";
import { differentialInputArb, farFromTransitions } from "../helpers.js";
import type { DifferentialInput } from "../helpers.js";
import { oracleDecision } from "./oracle.js";

const NUM_RUNS = 200;
// The oracle scans every minute, so runs are slow (~25 ms each); allow generous headroom on CI.
const TIMEOUT_MS = 120_000;

/** Engine view reduced to what the oracle reports: decision, failing parties, time gate. */
function engineView(input: DifferentialInput) {
  const result = evaluate(input as NegotiationRequest);
  if (!result.ok) return { ok: false as const, error: result.error };
  const failing = result.reasons
    .filter((r) => r.code === "OUTSIDE_AVAILABILITY" || r.code === "IN_BLACKOUT")
    .map((r) => r.participantId as string)
    .sort();
  const gate = result.reasons.some((r) => r.code === "IN_PAST")
    ? "IN_PAST"
    : result.reasons.some((r) => r.code === "INSUFFICIENT_NOTICE")
      ? "INSUFFICIENT_NOTICE"
      : "OK";
  return { ok: true as const, decision: result.decision, failing, gate };
}

function agrees(input: DifferentialInput): void {
  const oracle = oracleDecision(input);
  expect(engineView(input)).toEqual({ ok: true, ...oracle });
}

describe("ORC-01: evaluate agrees with the oracle (decision, failing parties, gate)", () => {
  it("property", () => {
    fc.assert(fc.property(differentialInputArb(), agrees), { numRuns: NUM_RUNS });
  }, TIMEOUT_MS);

  it("generator sanity: at least 25% book and 25% counter_offer over 200 samples", () => {
    const samples = fc.sample(differentialInputArb(), { numRuns: 200, seed: 7 });
    const book = samples.filter((s) => oracleDecision(s).decision === "book").length;
    expect(book).toBeGreaterThanOrEqual(50);
    expect(samples.length - book).toBeGreaterThanOrEqual(50);
  }, TIMEOUT_MS);
});

describe("ORC-01 generator: transition filter", () => {
  it("rejects dates within a day of a transition of any zone involved, accepts quiet dates", () => {
    // US spring-forward 2025-03-09; Lord_Howe fall-back 2025-04-06; Berlin fall-back 2025-10-26.
    expect(farFromTransitions("2025-03-09", "UTC", ["America/New_York"])).toBe(false);
    expect(farFromTransitions("2025-03-07", "America/New_York", [])).toBe(false);
    expect(farFromTransitions("2025-04-06", "Asia/Manila", ["UTC", "Australia/Lord_Howe"])).toBe(false);
    expect(farFromTransitions("2025-10-27", "Europe/Berlin", [])).toBe(false);
    expect(farFromTransitions("2025-01-13", "America/New_York", ["Australia/Lord_Howe", "Europe/Berlin"])).toBe(true);
    expect(farFromTransitions("2025-03-09", "Asia/Kathmandu", ["Asia/Kolkata", "Asia/Manila", "UTC"])).toBe(true);
  });
});
