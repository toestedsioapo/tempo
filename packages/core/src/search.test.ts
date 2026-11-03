import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import type { Span } from "./intervals.js";
import { toIsoSlot, formatUtc } from "./render.js";
import { searchSlots } from "./search.js";
import type { PartyRules } from "./types.js";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const ms = (iso: string): number => DateTime.fromISO(iso, { zone: "utc" }).toMillis();
const span = (from: string, to: string): Span => ({ startMs: ms(from), endMs: ms(to) });
type Rules = PartyRules["weeklyRules"];
const party = (partyId: string, weeklyRules: Rules, opts: { zone?: string; blackouts?: string[] } = {}): PartyRules => ({
  partyId,
  timeZone: opts.zone ?? "UTC",
  weeklyRules,
  blackouts: opts.blackouts ?? [],
});
const ALL_DAY = [{ start: "00:00", end: "24:00" }];
const always: Rules = {
  monday: ALL_DAY,
  tuesday: ALL_DAY,
  wednesday: ALL_DAY,
  thursday: ALL_DAY,
  friday: ALL_DAY,
  saturday: ALL_DAY,
  sunday: ALL_DAY,
};
const bob = party("bob", always);
/** EX-21's alice: monday 08:00-10:00 and 11:00-13:00 UTC. */
const splitAlice = party("alice", {
  monday: [
    { start: "08:00", end: "10:00" },
    { start: "11:00", end: "13:00" },
  ],
});
const REQ = span("2025-01-06T10:00:00Z", "2025-01-06T11:00:00Z");

type Args = Parameters<typeof searchSlots>[0];
const search = (over: Partial<Args> = {}): Span[] =>
  searchSlots({
    requested: REQ,
    boundMs: ms("2025-01-03T00:00:00Z"),
    parties: [splitAlice, bob],
    horizonDays: 14,
    stepMinutes: 15,
    maxSuggestions: 3,
    ...over,
  });
const starts = (spans: Span[]): string[] => spans.map((s) => formatUtc(s.startMs));

describe("EX-21 shape", () => {
  it("ranks by distance, ties earlier first, greedy without overlap", () => {
    expect(starts(search())).toEqual(["2025-01-06T09:00:00Z", "2025-01-06T11:00:00Z", "2025-01-06T08:00:00Z"]);
  });
});

describe("CORE-25 lattice anchored at the requested start", () => {
  it.each([15, 30])("step %i: every slot start is rs + k*step", (step) => {
    const req = span("2025-01-06T10:07:00Z", "2025-01-06T11:07:00Z");
    const slots = search({ requested: req, stepMinutes: step, maxSuggestions: 10 });
    expect(slots.length).toBeGreaterThan(0);
    for (const s of slots) expect(Math.abs((s.startMs - req.startMs) % (step * MIN))).toBe(0);
  });

  it("a step of 7 minutes (does not divide 24 h) stays anchored at rs across days", () => {
    const alice = party("alice", { wednesday: [{ start: "10:00", end: "12:00" }] });
    const slots = search({ parties: [alice, bob], stepMinutes: 7, horizonDays: 3, maxSuggestions: 10 });
    // 2 days = 2880 min = 411.4 steps; the first lattice point inside is 412 * 7 = 2884 min (10:04).
    expect(slots.map((s) => [formatUtc(s.startMs), formatUtc(s.endMs)])).toEqual([
      ["2025-01-08T10:04:00Z", "2025-01-08T11:04:00Z"],
    ]);
  });
});

describe("CORE-26 horizon is inclusive", () => {
  it("a fitting slot exactly H*24h away (either side) is included", () => {
    const alice = party("alice", { sunday: [{ start: "10:00", end: "11:00" }], tuesday: [{ start: "10:00", end: "11:00" }] });
    expect(starts(search({ parties: [alice, bob], horizonDays: 1 }))).toEqual([
      "2025-01-05T10:00:00Z",
      "2025-01-07T10:00:00Z",
    ]);
  });

  it("one step beyond the horizon is excluded", () => {
    const alice = party("alice", { tuesday: [{ start: "10:15", end: "11:15" }] });
    expect(search({ parties: [alice, bob], horizonDays: 1 })).toEqual([]);
    expect(starts(search({ parties: [alice, bob], horizonDays: 2 }))).toEqual(["2025-01-07T10:15:00Z"]);
  });
});

describe("CORE-27 maxSuggestions", () => {
  const all = [party("alice", always), bob];
  it.each([1, 3, 10])("honours %i", (n) => {
    expect(search({ parties: all, maxSuggestions: n })).toHaveLength(n);
  });
  it("returns fewer when the horizon runs out", () => {
    expect(starts(search({ horizonDays: 1, maxSuggestions: 10 }))).toEqual([
      "2025-01-06T09:00:00Z",
      "2025-01-06T11:00:00Z",
      "2025-01-06T08:00:00Z",
      "2025-01-06T12:00:00Z",
    ]);
  });
  it("returns [] when nothing fits", () => {
    expect(search({ parties: [party("alice", {}), bob] })).toEqual([]);
  });
});

describe("CORE-28 ties go to the earlier start", () => {
  it("earlier of a tied pair first", () => {
    expect(starts(search({ maxSuggestions: 2 }))).toEqual(["2025-01-06T09:00:00Z", "2025-01-06T11:00:00Z"]);
  });
  it("when only one of the tied pair is picked, it is the earlier", () => {
    expect(starts(search({ maxSuggestions: 1 }))).toEqual(["2025-01-06T09:00:00Z"]);
  });
  it("the later of a tied pair is picked when the earlier does not fit", () => {
    const alice = party("alice", { monday: [{ start: "11:00", end: "12:00" }, { start: "08:30", end: "09:30" }] });
    // 09:00 (1 h before) does not fit; 11:00 (1 h after) does.
    expect(starts(search({ parties: [alice, bob], maxSuggestions: 1 }))).toEqual(["2025-01-06T11:00:00Z"]);
  });
});

describe("CORE-29 candidate length is the real request duration", () => {
  it.each([
    ["1 h", "2025-01-06T10:00:00Z", "2025-01-06T11:00:00Z"],
    ["23 h 59 min", "2025-01-06T00:00:00Z", "2025-01-06T23:59:00Z"],
  ])("%s", (_n, from, to) => {
    const req = span(from, to);
    const slots = search({ requested: req, parties: [party("alice", always), bob] });
    expect(slots).toHaveLength(3);
    for (const s of slots) expect(s.endMs - s.startMs).toBe(req.endMs - req.startMs);
  });
});

describe("CORE-43 greedy non-overlap (G22, A-27)", () => {
  it("an overlapping candidate is skipped and never revisited; touching slots are both kept", () => {
    const alice = party("alice", { monday: [{ start: "08:00", end: "10:30" }] });
    // 09:30 is picked first; 08:30 touches it and is kept; 08:00 would overlap 08:30.
    expect(search({ parties: [alice, bob], maxSuggestions: 10, horizonDays: 1 }).map((s) => [formatUtc(s.startMs), formatUtc(s.endMs)])).toEqual([
      ["2025-01-06T09:30:00Z", "2025-01-06T10:30:00Z"],
      ["2025-01-06T08:30:00Z", "2025-01-06T09:30:00Z"],
    ]);
  });
  it("slots never overlap one another", () => {
    const slots = search({ parties: [party("alice", always), bob], maxSuggestions: 10, stepMinutes: 1 });
    for (const a of slots) for (const b of slots) if (a !== b) expect(a.startMs < b.endMs && b.startMs < a.endMs).toBe(false);
  });
});

describe("bound (now + minNotice)", () => {
  const all = [party("alice", always), bob];
  it("pushes the first lattice point past the bound", () => {
    expect(starts(search({ parties: all, boundMs: REQ.startMs + 20 * MIN }))).toEqual([
      "2025-01-06T10:30:00Z",
      "2025-01-06T11:30:00Z",
      "2025-01-06T12:30:00Z",
    ]);
  });
  it("a candidate exactly at the bound is kept", () => {
    expect(starts(search({ parties: all, boundMs: REQ.startMs + 30 * MIN, maxSuggestions: 1 }))).toEqual([
      "2025-01-06T10:30:00Z",
    ]);
  });
  it("the requested slot itself is distance 0 when it fits", () => {
    expect(starts(search({ parties: all, maxSuggestions: 1 }))).toEqual(["2025-01-06T10:00:00Z"]);
  });
});

describe("blackouts and intersection", () => {
  it("a blacked-out day is skipped", () => {
    const alice = party("alice", { monday: [{ start: "10:00", end: "11:00" }] }, { blackouts: ["2025-01-06"] });
    // 2024-12-30 is before the bound; 2025-01-20 is exactly 14 days away.
    expect(starts(search({ parties: [alice, bob] }))).toEqual(["2025-01-13T10:00:00Z", "2025-01-20T10:00:00Z"]);
  });
  it("three parties intersect", () => {
    const a = party("a", { monday: [{ start: "08:00", end: "12:00" }] });
    const b = party("b", { monday: [{ start: "10:30", end: "14:00" }] });
    const c = party("c", { monday: [{ start: "06:00", end: "11:45" }] });
    expect(starts(search({ parties: [a, b, c], horizonDays: 1, maxSuggestions: 10 }))).toEqual(["2025-01-06T10:30:00Z"]);
  });
});

describe("DST", () => {
  it("a slot straddling spring-forward keeps the real duration", () => {
    // Request: Sat 2025-03-08 01:00-04:00 EST = 06:00Z-09:00Z (3 h).
    const req = span("2025-03-08T06:00:00Z", "2025-03-08T09:00:00Z");
    const alice = party("alice", { sunday: [{ start: "00:00", end: "06:00" }] }, { zone: "America/New_York" });
    const b = party("bob", { sunday: [{ start: "06:00", end: "09:00" }] });
    const slots = search({ requested: req, boundMs: ms("2025-03-01T00:00:00Z"), parties: [alice, b], horizonDays: 1 });
    expect(slots).toEqual([span("2025-03-09T06:00:00Z", "2025-03-09T09:00:00Z")]);
    const [first] = slots;
    expect(toIsoSlot(first as Span, "America/New_York")).toMatchObject({
      start: "2025-03-09T01:00:00-05:00",
      end: "2025-03-09T05:00:00-04:00",
    });
  });

  it("fall-back overlap hour slots come back with the right offsets", () => {
    // Request: Sat 2025-11-01 01:00-01:30 EDT = 05:00Z-05:30Z.
    const req = span("2025-11-01T05:00:00Z", "2025-11-01T05:30:00Z");
    const b = party("bob", { sunday: [{ start: "05:00", end: "05:30" }, { start: "06:00", end: "06:30" }] });
    const slots = search({
      requested: req,
      boundMs: ms("2025-10-25T00:00:00Z"),
      parties: [party("alice", always), b],
      horizonDays: 2,
      maxSuggestions: 10,
    });
    // Saturday's own 05:00Z / 06:00Z are not bob's (bob is sunday only); 24 h then 25 h away.
    expect(slots.map((s) => toIsoSlot(s, "America/New_York"))).toEqual([
      { start: "2025-11-02T01:00:00-04:00", end: "2025-11-02T01:30:00-04:00", startUtc: "2025-11-02T05:00:00Z", endUtc: "2025-11-02T05:30:00Z" },
      { start: "2025-11-02T01:00:00-05:00", end: "2025-11-02T01:30:00-05:00", startUtc: "2025-11-02T06:00:00Z", endUtc: "2025-11-02T06:30:00Z" },
    ]);
  });
});

describe("range edges", () => {
  it("a slot right at the far edge of the horizon fits when availability ends exactly there", () => {
    const req = span("2025-01-06T10:00:00Z", "2025-01-06T11:00:00Z");
    const alice = party("alice", { tuesday: [{ start: "10:00", end: "11:00" }] });
    const slots = search({ requested: req, parties: [alice, bob], horizonDays: 1 });
    expect(slots.map((s) => s.endMs)).toEqual([req.startMs + DAY + HOUR]);
  });
});
