// ORC-01: the engine and the independent oracle agree on generated inputs, DST included (A-64):
// decision, failing participants, gate, the exact ranked slots (evaluate on a counter_offer,
// suggest always) and the C10 request-time errors. A disagreement is a bug to shrink and pin as a
// regression `it(...)` below, never something to exclude.
import fc from "fast-check";
import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import { evaluate, suggest } from "../../src/index.js";
import type { NegotiationRequest, NegotiationResult } from "../../src/index.js";
import { coverWeekly, dstFocusedInputArb, hasMidnightTouchingChain, negotiationInputArb, transitionDates } from "../generators.js";
import type { DifferentialInput } from "../generators.js";
import { propRuns, propTimeoutMs } from "../runs.js";
import { oracleSlots } from "./oracle.js";

// Oracle runs are slow-ish; leave headroom for 5,000 nightly runs and CI.
const TIMEOUT_MS = propTimeoutMs();
// Conservative floor for the midnight-touching chain share (measured share is far higher).
const MIDNIGHT_CHAIN_MIN = 20;

const iso = (ms: number): string => DateTime.fromMillis(ms, { zone: "utc" }).toFormat("yyyy-MM-dd'T'HH:mm:ss'Z'");
const day = (d: string): number => DateTime.fromISO(d, { zone: "utc" }).toMillis();

function engineView(r: NegotiationResult) {
  if (!r.ok) return { ok: false as const, code: r.error.code, field: (r.error.details as { field?: string } | undefined)?.field };
  const failing = r.reasons
    .filter((x) => x.code === "OUTSIDE_AVAILABILITY" || x.code === "IN_BLACKOUT")
    .map((x) => x.participantId as string)
    .sort();
  const gate = r.reasons.some((x) => x.code === "IN_PAST")
    ? "IN_PAST"
    : r.reasons.some((x) => x.code === "INSUFFICIENT_NOTICE")
      ? "INSUFFICIENT_NOTICE"
      : "OK";
  return { ok: true as const, decision: r.decision, failing, gate, slots: r.slots.map((s) => [s.startUtc, s.endUtc]) };
}

export function agrees(input: DifferentialInput): void {
  const oracle = oracleSlots(input);
  const e = evaluate(input as NegotiationRequest);
  const s = suggest(input as NegotiationRequest);
  if ("error" in oracle) {
    for (const r of [e, s]) {
      expect(engineView(r)).toEqual({ ok: false, code: oracle.error.code, field: oracle.error.field });
    }
    return;
  }
  const slots = oracle.slots.map((x) => [iso(x.startMs), iso(x.endMs)]);
  const requested = [[iso(oracle.requested.startMs), iso(oracle.requested.endMs)]];
  const head = { ok: true, decision: oracle.decision, failing: oracle.failing, gate: oracle.gate };
  // suggest always returns the ranked search; evaluate only on a counter_offer (A-66).
  expect(engineView(s)).toEqual({ ...head, slots });
  expect(engineView(e)).toEqual({ ...head, slots: oracle.decision === "book" ? requested : slots });
}

describe("ORC-01: evaluate and suggest agree with the oracle (decision, failing, gate, slots, DST errors)", () => {
  it("property", () => {
    fc.assert(fc.property(negotiationInputArb(), agrees), { numRuns: propRuns() });
  }, TIMEOUT_MS);

  it("DST-focused property: gap/overlap rule edges and C10 request times", () => {
    fc.assert(fc.property(dstFocusedInputArb(), agrees), { numRuns: propRuns() });
  }, TIMEOUT_MS);

  it("DST-focused generator sanity: adjusted rules, errors and counter-offers all occur", () => {
    const samples = fc.sample(dstFocusedInputArb(), { numRuns: 300, seed: 5 });
    const results = samples.map((x) => suggest(x as NegotiationRequest));
    expect(results.filter((r) => !r.ok && r.error.code === "DST_NONEXISTENT_LOCAL_TIME").length).toBeGreaterThanOrEqual(3);
    expect(results.filter((r) => !r.ok && r.error.code === "DST_AMBIGUOUS_LOCAL_TIME").length).toBeGreaterThanOrEqual(3);
    expect(results.filter((r) => r.ok && r.reasons.some((x) => x.code === "DST_RULE_ADJUSTED")).length).toBeGreaterThanOrEqual(10);
    expect(results.filter((r) => r.ok && r.decision === "book").length).toBeGreaterThanOrEqual(20);
    expect(results.filter((r) => r.ok && r.slots.length > 1).length).toBeGreaterThanOrEqual(20);
  }, TIMEOUT_MS);

  it("generator sanity over 400 samples", () => {
    const samples = fc.sample(negotiationInputArb(), { numRuns: 400, seed: 7 });
    const results = samples.map((x) => oracleSlots(x));
    const errors = results.filter((r) => "error" in r).length;
    const okResults = results.flatMap((r) => ("error" in r ? [] : [r]));
    // Both branches and the DST error path stay populated, so a generator edit cannot silently empty one.
    const book = okResults.filter((r) => r.decision === "book").length;
    expect(book).toBeGreaterThanOrEqual(40);
    expect(okResults.length - book).toBeGreaterThanOrEqual(40);
    expect(errors).toBeGreaterThanOrEqual(1);
    expect(okResults.some((r) => r.gate === "IN_PAST")).toBe(true);
    expect(okResults.some((r) => r.gate === "INSUFFICIENT_NOTICE")).toBe(true);
    expect(okResults.some((r) => r.decision === "counter_offer" && r.slots.length > 0)).toBe(true);
    expect(okResults.some((r) => r.decision === "counter_offer" && r.slots.length === 0)).toBe(true);
    // G-01: at least half the request dates are within +-2 days of a transition of a zone involved.
    const near = samples.filter((x) => {
      const zones = [x.request.timeZone, ...x.participants.map((p) => p.timeZone)];
      return zones.some((z) =>
        transitionDates(z).some((d) => Math.abs(day(d) - day(x.request.date)) <= 2 * 86_400_000),
      );
    }).length;
    expect(near).toBeGreaterThanOrEqual(samples.length / 2);
    // G-02: at least half of the start times are in 00:00-04:00.
    expect(samples.filter((x) => x.request.start < "04:00").length).toBeGreaterThanOrEqual(samples.length / 2);
    // G-03: a "...-24:00"/"...-00:00" rule touching a next-day "00:00-..." rule.
    expect(samples.filter(hasMidnightTouchingChain).length).toBeGreaterThanOrEqual(MIDNIGHT_CHAIN_MIN);
  }, TIMEOUT_MS);
});

describe("ORC-01 pinned rows", () => {
  it("horizon edge: the only fitting slot is exactly H*24h away (inclusive)", () => {
    const input: DifferentialInput = {
      request: { date: "2025-01-06", start: "09:00", end: "10:00", timeZone: "UTC" },
      participants: [
        { partyId: "a", timeZone: "UTC", weeklyRules: { tuesday: [{ start: "09:00", end: "10:00" }] } },
        { partyId: "b", timeZone: "UTC", weeklyRules: { tuesday: [{ start: "00:00", end: "24:00" }], monday: [{ start: "00:00", end: "24:00" }] } },
      ],
      options: { now: "2025-01-01T00:00:00Z", searchHorizonDays: 1 },
    };
    agrees(input);
    const r = suggest(input as NegotiationRequest);
    expect(r.ok && r.slots.map((x) => x.startUtc)).toEqual(["2025-01-07T09:00:00Z"]);
  });
});

describe("generator validity guard", () => {
  it("no generated rule has start == end (G23: that is INVALID_INTERVAL, not an oracle case)", () => {
    // Regression for seed 177050573: Berlin 2026-03-29 produced 00:00-00:00 from a 23-hour day.
    fc.assert(
      fc.property(negotiationInputArb(), dstFocusedInputArb(), (a, b) => {
        for (const input of [a, b]) {
          for (const p of input.participants) {
            for (const rules of Object.values(p.weeklyRules)) {
              for (const r of rules ?? []) expect(r.start).not.toBe(r.end);
            }
          }
        }
      }),
      { numRuns: 3000 },
    );
  }, TIMEOUT_MS);

  it("the Berlin spring-forward day: a 1,380-minute piece becomes 00:00-24:00, not 00:00-00:00", () => {
    const from = DateTime.fromISO("2026-03-29T00:00", { zone: "Europe/Berlin" });
    const to = from.plus({ minutes: 1380 }); // the whole 23-hour local day
    expect(coverWeekly(from, to, [], [], false, false)).toEqual({ sunday: [{ start: "00:00", end: "24:00" }] });
    // Not at midnight: end one minute earlier rather than start == end.
    const noon = DateTime.fromISO("2026-03-29T12:00", { zone: "Europe/Berlin" });
    const rules = coverWeekly(noon, noon.plus({ minutes: 1380 }), [], [], false, false);
    for (const list of Object.values(rules)) for (const r of list ?? []) expect(r.start).not.toBe(r.end);
  });
});
