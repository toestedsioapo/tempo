import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import { classifyWallTime, findDstError, wallTimeToMs } from "./dst.js";
import { internalError } from "./internal-error.js";
import type { ResolvedNegotiationRequest } from "./types.js";

const ms = (iso: string): number => DateTime.fromISO(iso, { zone: "utc" }).toMillis();
const offsetAt = (t: number, zone: string): number => DateTime.fromMillis(t, { zone }).offset;

describe("classifyWallTime: instants.length", () => {
  it.each([
    // CORE-35 gaps
    ["America/New_York", "2025-03-09", "02:00", 0],
    ["America/New_York", "2025-03-09", "02:30", 0],
    ["America/New_York", "2025-03-09", "02:59", 0],
    ["Europe/Berlin", "2025-03-30", "02:30", 0],
    ["Australia/Sydney", "2025-10-05", "02:30", 0],
    ["Australia/Lord_Howe", "2025-10-05", "02:15", 0],
    // CORE-36 overlaps
    ["America/New_York", "2025-11-02", "01:00", 2],
    ["America/New_York", "2025-11-02", "01:59", 2],
    ["Europe/Berlin", "2025-10-26", "02:30", 2],
    ["Australia/Sydney", "2025-04-06", "02:30", 2],
    ["Australia/Lord_Howe", "2025-04-06", "01:45", 2],
    // CORE-37 unique
    ["America/New_York", "2025-03-09", "01:59", 1],
    ["America/New_York", "2025-03-09", "03:00", 1],
    ["America/New_York", "2025-11-02", "00:59", 1],
    ["America/New_York", "2025-11-02", "02:00", 1],
    ["Australia/Lord_Howe", "2025-10-05", "02:30", 1],
    // Manila has no DST
    ["Asia/Manila", "2025-03-09", "02:30", 1],
    ["Asia/Manila", "2025-11-02", "01:30", 1],
    ["Asia/Manila", "2025-10-05", "02:15", 1],
  ] as const)("%s %s %s -> %i", (zone, date, time, n) => {
    const c = classifyWallTime(date, time, zone);
    expect(c.instants).toHaveLength(n);
    expect(c.transitionMs === null).toBe(n === 1);
  });
});

describe("classifyWallTime: exact values", () => {
  it("NY gap 02:30", () => {
    const c = classifyWallTime("2025-03-09", "02:30", "America/New_York");
    expect(c.transitionMs).toBe(ms("2025-03-09T07:00:00Z"));
    expect(c.offsetBeforeMinutes).toBe(-300);
    expect(c.offsetAfterMinutes).toBe(-240);
    expect(offsetAt((c.transitionMs as number) - 60_000, "America/New_York")).toBe(-300);
    expect(offsetAt(c.transitionMs as number, "America/New_York")).toBe(-240);
  });
  it("NY overlap 01:30", () => {
    const c = classifyWallTime("2025-11-02", "01:30", "America/New_York");
    expect(c.instants).toEqual([
      { ms: ms("2025-11-02T05:30:00Z"), offsetMinutes: -240 },
      { ms: ms("2025-11-02T06:30:00Z"), offsetMinutes: -300 },
    ]);
    expect(c.transitionMs).toBe(ms("2025-11-02T06:00:00Z"));
    expect(c.offsetBeforeMinutes).toBe(-240);
    expect(c.offsetAfterMinutes).toBe(-300);
  });
  it("Lord_Howe gap offsets +630 -> +660", () => {
    const c = classifyWallTime("2025-10-05", "02:15", "Australia/Lord_Howe");
    expect(c.offsetBeforeMinutes).toBe(630);
    expect(c.offsetAfterMinutes).toBe(660);
    expect(c.transitionMs).toBe(ms("2025-10-04T15:30:00Z"));
  });
  it('"24:00" is next date 00:00', () => {
    const c = classifyWallTime("2025-01-06", "24:00", "America/New_York");
    expect(c.instants).toEqual([{ ms: ms("2025-01-07T05:00:00Z"), offsetMinutes: -300 }]);
  });
});

describe("wallTimeToMs (A-53, G34)", () => {
  it.each([
    ["2025-01-06", "09:00", "America/New_York", "2025-01-06T14:00:00Z"],
    ["2025-11-02", "01:30", "America/New_York", "2025-11-02T05:30:00Z"],
    ["2025-10-26", "02:30", "Europe/Berlin", "2025-10-26T00:30:00Z"],
    ["2025-04-06", "02:30", "Australia/Sydney", "2025-04-05T15:30:00Z"],
    ["2025-03-09", "02:30", "America/New_York", "2025-03-09T07:00:00Z"],
    ["2025-10-05", "02:15", "Australia/Lord_Howe", "2025-10-04T15:30:00Z"],
    ["2025-01-06", "24:00", "America/New_York", "2025-01-07T05:00:00Z"],
  ] as const)("%s %s %s -> %s", (date, time, zone, expected) => {
    expect(wallTimeToMs(date, time, zone)).toBe(ms(expected));
  });
});

function req(date: string, start: string, end: string, zone = "America/New_York"): ResolvedNegotiationRequest {
  return { request: { date, start, end, timeZone: zone } } as unknown as ResolvedNegotiationRequest;
}

describe("findDstError", () => {
  it("valid request -> null", () => expect(findDstError(req("2025-01-06", "09:00", "10:00"))).toBeNull());
  it("end in a gap", () => {
    expect(findDstError(req("2025-03-09", "01:00", "02:30"))).toEqual({
      ok: false,
      error: {
        code: "DST_NONEXISTENT_LOCAL_TIME",
        message: "2025-03-09T02:30 does not exist in America/New_York (clocks skip forward).",
        details: {
          field: "request.end",
          localTime: "2025-03-09T02:30",
          timeZone: "America/New_York",
          transitionUtc: "2025-03-09T07:00:00Z",
          offsetBefore: "-05:00",
          offsetAfter: "-04:00",
        },
      },
    });
  });
  it("end on the next date in a gap", () => {
    const r = findDstError(req("2025-03-08", "23:30", "02:30"));
    expect(r?.error.code).toBe("DST_NONEXISTENT_LOCAL_TIME");
    expect(r?.error.details).toMatchObject({ field: "request.end", localTime: "2025-03-09T02:30" });
  });
  it("end in an overlap", () => {
    const r = findDstError(req("2025-11-02", "00:30", "01:30"));
    expect(r?.error.code).toBe("DST_AMBIGUOUS_LOCAL_TIME");
    expect(r?.error.details).toEqual({
      field: "request.end",
      localTime: "2025-11-02T01:30",
      timeZone: "America/New_York",
      candidates: [
        { utc: "2025-11-02T05:30:00Z", offset: "-04:00" },
        { utc: "2025-11-02T06:30:00Z", offset: "-05:00" },
      ],
    });
  });
  it("start error wins over end error", () => {
    const r = findDstError(req("2025-03-09", "02:30", "02:45"));
    expect(r?.error.details).toMatchObject({ field: "request.start" });
  });
});

describe("internalError", () => {
  it("is the A-63 value with no details", () => {
    expect(internalError()).toEqual({
      ok: false,
      error: { code: "INTERNAL_ERROR", message: "Internal error: Tempo failed while evaluating an accepted request. This is a bug." },
    });
    expect("details" in internalError().error).toBe(false);
  });
});
