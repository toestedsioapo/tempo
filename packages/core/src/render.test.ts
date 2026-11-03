import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { formatOffset, formatUtc, toIsoSlot } from "./render.js";

const ms = (iso: string): number => DateTime.fromISO(iso, { zone: "utc" }).toMillis();
const slot = (s: string, e: string) => ({ startMs: ms(s), endMs: ms(e) });

describe("formatUtc", () => {
  it("renders Z form without millis", () =>
    expect(formatUtc(ms("2025-01-06T14:30:00Z"))).toBe("2025-01-06T14:30:00Z"));
});

describe("toIsoSlot (SPEC 4.9)", () => {
  it("EX-01", () =>
    expect(toIsoSlot(slot("2025-01-06T14:30:00Z", "2025-01-06T15:30:00Z"), "America/New_York")).toEqual({
      start: "2025-01-06T09:30:00-05:00",
      end: "2025-01-06T10:30:00-05:00",
      startUtc: "2025-01-06T14:30:00Z",
      endUtc: "2025-01-06T15:30:00Z",
    }));
  it("London winter is +00:00", () =>
    expect(toIsoSlot(slot("2025-01-06T14:30:00Z", "2025-01-06T15:30:00Z"), "Europe/London").start).toBe(
      "2025-01-06T14:30:00+00:00",
    ));
  it.each(["UTC", "GMT", "utc", "Utc", "gmt"])("%s renders Z", (z) =>
    expect(toIsoSlot(slot("2025-01-06T14:30:00Z", "2025-01-06T15:30:00Z"), z).start).toBe("2025-01-06T14:30:00Z"));
  it("Kathmandu is +05:45", () =>
    expect(toIsoSlot(slot("2025-01-06T14:30:00Z", "2025-01-06T15:30:00Z"), "Asia/Kathmandu").start).toBe(
      "2025-01-06T20:15:00+05:45",
    ));
});

describe("formatOffset", () => {
  it.each([
    [-300, "-05:00"],
    [345, "+05:45"],
    [0, "+00:00"],
    [630, "+10:30"],
  ] as const)("%i -> %s", (m, s) => expect(formatOffset(m)).toBe(s));
});
