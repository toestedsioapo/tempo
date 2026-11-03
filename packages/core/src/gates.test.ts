import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { requestedSpan, timeGate } from "./gates.js";
import type { MeetingRequest } from "./types.js";

const ms = (iso: string): number => DateTime.fromISO(iso, { zone: "utc" }).toMillis();
const req = (date: string, start: string, end: string, timeZone = "America/New_York"): MeetingRequest =>
  ({ date, start, end, timeZone }) as MeetingRequest;
const HOUR = 3600_000;

describe("requestedSpan (C7)", () => {
  it("09:30-10:30 is one hour", () => {
    const s = requestedSpan(req("2025-01-06", "09:30", "10:30"));
    expect(s.startMs).toBe(ms("2025-01-06T14:30:00Z"));
    expect(s.endMs - s.startMs).toBe(HOUR);
  });
  it("23:00-01:00 ends the next day (EX-08)", () => {
    const s = requestedSpan(req("2025-01-06", "23:00", "01:00"));
    expect(s.endMs).toBe(ms("2025-01-07T06:00:00Z"));
  });
  it("end 00:00 means next midnight", () => {
    const s = requestedSpan(req("2025-01-06", "22:00", "00:00"));
    expect(s.endMs).toBe(ms("2025-01-07T05:00:00Z"));
  });
  it("uses real duration across spring-forward", () => {
    const s = requestedSpan(req("2025-03-09", "01:00", "04:00"));
    expect(s.endMs - s.startMs).toBe(2 * HOUR);
  });
});

describe("timeGate (CORE-22, CORE-23)", () => {
  const start = ms("2025-01-06T14:30:00Z");
  it("start == now is OK", () => expect(timeGate(start, start, 0)).toBe("OK"));
  it("now = start + 1s is IN_PAST", () => expect(timeGate(start, start + 1000, 0)).toBe("IN_PAST"));
  it("now = start - 120min is OK with notice 120", () =>
    expect(timeGate(start, start - 120 * 60_000, 120)).toBe("OK"));
  it("one second short is INSUFFICIENT_NOTICE", () =>
    expect(timeGate(start, start - 120 * 60_000 + 1000, 120)).toBe("INSUFFICIENT_NOTICE"));
  it("minNotice 525600 with far-past and future now", () => {
    expect(timeGate(start, start - 525600 * 60_000 - 1000, 525600)).toBe("OK");
    expect(timeGate(start, start - 525600 * 60_000 + 1000, 525600)).toBe("INSUFFICIENT_NOTICE");
    expect(timeGate(start, start + 1000, 525600)).toBe("IN_PAST");
  });
});
