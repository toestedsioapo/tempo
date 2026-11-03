import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import { checkParticipant, participantReasons } from "./availability.js";
import type { Span } from "./intervals.js";
import type { PartyRules } from "./types.js";

const ms = (iso: string): number => DateTime.fromISO(iso, { zone: "utc" }).toMillis();
const span = (from: string, to: string): Span => ({ startMs: ms(from), endMs: ms(to) });
const party = (weeklyRules: PartyRules["weeklyRules"], blackouts: string[] = [], timeZone = "UTC"): PartyRules => ({
  partyId: "alice",
  timeZone,
  weeklyRules,
  blackouts,
});
const ruleOf = (r: ReturnType<typeof checkParticipant>) =>
  r.pass ? { ownerDate: r.match.ownerDate, weekday: r.match.weekday, rule: r.match.rule } : null;

describe("checkParticipant (SPEC 4.3, 4.6, 3.6)", () => {
  it("passes with the matching instance", () => {
    const r = checkParticipant(party({ monday: [{ start: "09:00", end: "17:00" }] }), span("2025-01-06T10:00:00Z", "2025-01-06T11:00:00Z"));
    expect(ruleOf(r)).toEqual({ ownerDate: "2025-01-06", weekday: "monday", rule: { start: "09:00", end: "17:00" } });
  });

  it("match is the earliest-starting instance containing the slot start", () => {
    const p = party({ monday: [{ start: "09:00", end: "11:00" }, { start: "08:00", end: "12:00" }] });
    const r = checkParticipant(p, span("2025-01-06T10:00:00Z", "2025-01-06T11:00:00Z"));
    expect(ruleOf(r)?.rule).toEqual({ start: "08:00", end: "12:00" });
  });

  it("an instance ending exactly at the slot start still matches (closed intervals)", () => {
    const p = party({ monday: [{ start: "08:00", end: "10:00" }, { start: "10:00", end: "12:00" }] });
    const r = checkParticipant(p, span("2025-01-06T10:00:00Z", "2025-01-06T11:00:00Z"));
    expect(ruleOf(r)?.rule).toEqual({ start: "08:00", end: "10:00" });
  });

  it("a blacked-out instance is never the match", () => {
    const p = party({ sunday: [{ start: "22:00", end: "06:00" }], monday: [{ start: "00:00", end: "24:00" }] }, ["2025-01-05"]);
    const r = checkParticipant(p, span("2025-01-06T01:00:00Z", "2025-01-06T02:00:00Z"));
    expect(ruleOf(r)).toEqual({ ownerDate: "2025-01-06", weekday: "monday", rule: { start: "00:00", end: "24:00" } });
  });

  it("outside availability has no blocked date", () => {
    const r = checkParticipant(party({ tuesday: [{ start: "09:00", end: "17:00" }] }), span("2025-01-06T10:00:00Z", "2025-01-06T11:00:00Z"));
    expect(r).toEqual({ pass: false, reasonCode: "OUTSIDE_AVAILABILITY", blockedDate: null });
  });

  it("a blackout names the earliest blocked owner date", () => {
    const p = party({ sunday: [{ start: "22:00", end: "06:00" }], monday: [{ start: "00:00", end: "24:00" }] }, [
      "2025-01-06",
      "2025-01-05",
    ]);
    const r = checkParticipant(p, span("2025-01-06T01:00:00Z", "2025-01-06T02:00:00Z"));
    expect(r).toEqual({ pass: false, reasonCode: "IN_BLACKOUT", blockedDate: "2025-01-05" });
  });
});

describe("participantReasons", () => {
  it("failure reason first, then DST notes", () => {
    const p = { ...party({ sunday: [{ start: "02:30", end: "06:00" }] }, [], "America/New_York"), partyId: "bob" };
    const r = participantReasons(p, span("2025-03-09T08:00:00Z", "2025-03-09T12:00:00Z"));
    expect(r.failed).toBe(true);
    expect(r.reasons.map((x) => x.code)).toEqual(["OUTSIDE_AVAILABILITY", "DST_RULE_ADJUSTED"]);
  });

  it("a pass has only notes", () => {
    const r = participantReasons(party({ monday: [{ start: "09:00", end: "17:00" }] }), span("2025-01-06T10:00:00Z", "2025-01-06T11:00:00Z"));
    expect(r).toEqual({ failed: false, reasons: [] });
  });
});
