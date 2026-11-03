import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { validRequest } from "../test/helpers.js";
import {
  applyBlackouts,
  contains,
  expandInstances,
  findInvalidInterval,
  mergeSpans,
} from "./intervals.js";
import type { PartyRules, ResolvedNegotiationRequest } from "./types.js";

const ms = (iso: string): number => DateTime.fromISO(iso, { zone: "utc" }).toMillis();
const party = (timeZone: string, weeklyRules: PartyRules["weeklyRules"], blackouts: string[] = []): PartyRules => ({
  partyId: "p",
  timeZone,
  weeklyRules,
  blackouts,
});

describe("expandInstances", () => {
  const ny = party("America/New_York", { monday: [{ start: "09:00", end: "17:00" }] });
  it("EX-01 monday instance", () => {
    const out = expandInstances(ny, ms("2025-01-06T12:00:00Z"), ms("2025-01-06T13:00:00Z"));
    expect(out).toContainEqual({
      startMs: ms("2025-01-06T14:00:00Z"),
      endMs: ms("2025-01-06T22:00:00Z"),
      ownerDate: "2025-01-06",
      weekday: "monday",
      rule: { start: "09:00", end: "17:00" },
    });
  });
  it("overnight is owned by its start date", () => {
    const p = party("America/New_York", { monday: [{ start: "20:00", end: "06:00" }] });
    const [i] = expandInstances(p, ms("2025-01-06T12:00:00Z"), ms("2025-01-07T12:00:00Z"));
    expect(i).toMatchObject({
      startMs: ms("2025-01-07T01:00:00Z"),
      endMs: ms("2025-01-07T11:00:00Z"),
      ownerDate: "2025-01-06",
    });
  });
  it("24:00 ends at next-day 00:00", () => {
    const p = party("America/New_York", { monday: [{ start: "18:00", end: "24:00" }] });
    const [i] = expandInstances(p, ms("2025-01-06T12:00:00Z"), ms("2025-01-07T12:00:00Z"));
    expect(i?.endMs).toBe(ms("2025-01-07T05:00:00Z"));
  });
  it("EX-14 Berlin overnight across spring-forward is 7 real hours", () => {
    const p = party("Europe/Berlin", { saturday: [{ start: "22:00", end: "06:00" }] });
    const out = expandInstances(p, ms("2025-03-29T12:00:00Z"), ms("2025-03-30T12:00:00Z"));
    const i = out.find((x) => x.ownerDate === "2025-03-29");
    expect(i && i.endMs - i.startMs).toBe(7 * 3600_000);
  });
  it("weekday comes from the owner date in the party zone", () => {
    const p = party("Asia/Manila", { tuesday: [{ start: "09:00", end: "17:00" }] });
    // Monday 2025-01-06 20:00 in New York is Tuesday 09:00 in Manila.
    const at = ms("2025-01-07T01:00:00Z");
    const out = expandInstances(p, at, at);
    expect(out.find((x) => x.ownerDate === "2025-01-07")?.weekday).toBe("tuesday");
  });
  it("is sorted by startMs", () => {
    const p = party("UTC", { monday: [{ start: "09:00", end: "10:00" }], tuesday: [{ start: "01:00", end: "02:00" }] });
    const out = expandInstances(p, ms("2025-01-06T00:00:00Z"), ms("2025-01-08T00:00:00Z"));
    expect(out.map((x) => x.startMs)).toEqual([...out.map((x) => x.startMs)].sort((a, b) => a - b));
  });
});

describe("expandInstances ordering", () => {
  it("rules with equal starts come out ordered by end", () => {
    const p = party("UTC", { monday: [{ start: "10:00", end: "12:00" }, { start: "10:00", end: "11:00" }] });
    const out = expandInstances(p, ms("2025-01-06T00:00:00Z"), ms("2025-01-06T23:00:00Z"));
    const mondays = out.filter((i) => i.ownerDate === "2025-01-06").map((i) => i.rule.end);
    expect(mondays).toEqual(["11:00", "12:00"]);
  });
});

describe("mergeSpans / contains (CORE-14, CORE-15)", () => {
  it("merges touching, keeps one-minute gap, handles unsorted and empty", () => {
    expect(mergeSpans([{ startMs: 60, endMs: 120 }, { startMs: 0, endMs: 60 }])).toEqual([{ startMs: 0, endMs: 120 }]);
    expect(mergeSpans([{ startMs: 0, endMs: 60_000 }, { startMs: 120_000, endMs: 180_000 }])).toHaveLength(2);
    expect(mergeSpans([])).toEqual([]);
  });
  it("equal starts are ordered by end (any input order, same result)", () => {
    const a = { startMs: 0, endMs: 60 };
    const b = { startMs: 0, endMs: 120 };
    expect(mergeSpans([b, a])).toEqual([{ startMs: 0, endMs: 120 }]);
    expect(mergeSpans([a, b])).toEqual([{ startMs: 0, endMs: 120 }]);
  });
  it("contains", () => {
    const m = [{ startMs: ms("2025-01-06T09:00:00Z"), endMs: ms("2025-01-06T17:00:00Z") }];
    expect(contains(m, { startMs: ms("2025-01-06T16:00:00Z"), endMs: ms("2025-01-06T17:00:00Z") })).toBe(true);
    expect(contains(m, { startMs: ms("2025-01-06T16:01:00Z"), endMs: ms("2025-01-06T17:01:00Z") })).toBe(false);
    expect(contains([], { startMs: 0, endMs: 1 })).toBe(false);
  });
});

describe("applyBlackouts (CORE-16..18)", () => {
  const manila = party("Asia/Manila", { monday: [{ start: "09:00", end: "17:00" }] });
  const inst = (): ReturnType<typeof expandInstances> =>
    expandInstances(manila, ms("2025-01-06T00:00:00Z"), ms("2025-01-06T12:00:00Z"));
  it("removes by owner date in party zone, not the UTC date", () => {
    expect(applyBlackouts(inst(), ["2025-01-06"]).some((i) => i.ownerDate === "2025-01-06")).toBe(false);
    expect(applyBlackouts(inst(), ["2025-01-05"]).some((i) => i.ownerDate === "2025-01-06")).toBe(true);
  });
  it("blackout on the day after an overnight start leaves it intact", () => {
    const p = party("UTC", { monday: [{ start: "20:00", end: "06:00" }] });
    const i = expandInstances(p, ms("2025-01-06T00:00:00Z"), ms("2025-01-07T00:00:00Z"));
    expect(applyBlackouts(i, ["2025-01-07"])).toEqual(i);
  });
  it("[] is a no-op", () => {
    expect(applyBlackouts(inst(), [])).toEqual(inst());
  });
});

describe("findInvalidInterval (EX-09)", () => {
  const req = (): ResolvedNegotiationRequest => validRequest() as ResolvedNegotiationRequest;
  it("none -> null", () => {
    expect(findInvalidInterval(req())).toBeNull();
  });
  it("reports first offender in participant, weekday, interval order", () => {
    const r = req();
    r.participants[1]!.weeklyRules = {
      tuesday: [{ start: "10:00", end: "10:00" }],
      monday: [{ start: "09:00", end: "10:00" }, { start: "11:00", end: "11:00" }],
    };
    r.participants[0]!.weeklyRules = { friday: [{ start: "08:00", end: "08:00" }] };
    expect(findInvalidInterval(r)).toEqual({
      ok: false,
      error: {
        code: "INVALID_INTERVAL",
        message: "Availability interval start and end must differ.",
        details: { field: "participants[0].weeklyRules.friday[0]", start: "08:00", end: "08:00" },
      },
    });
    r.participants[0]!.weeklyRules = {};
    expect(findInvalidInterval(r)).toMatchObject({
      error: { details: { field: "participants[1].weeklyRules.monday[1]", start: "11:00", end: "11:00" } },
    });
  });
});
