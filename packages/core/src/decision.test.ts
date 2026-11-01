import { describe, it, expect } from "vitest";
import { decide } from "./decision";

const mockPartyA = {
  zone: "America/New_York",
  weeklyRules: {
    monday: [{ start: "09:00", end: "17:00" }],
    tuesday: [{ start: "09:00", end: "17:00" }],
    wednesday: [{ start: "09:00", end: "17:00" }],
    thursday: [{ start: "09:00", end: "17:00" }],
    friday: [{ start: "09:00", end: "17:00" }],
  },
  minimumNoticeMinutes: 30,
};

const mockPartyB = {
  zone: "America/Los_Angeles",
  weeklyRules: {
    monday: [{ start: "06:00", end: "14:00" }],
    tuesday: [{ start: "06:00", end: "14:00" }],
    wednesday: [{ start: "06:00", end: "14:00" }],
    thursday: [{ start: "06:00", end: "14:00" }],
    friday: [{ start: "06:00", end: "14:00" }],
  },
  minimumNoticeMinutes: 30,
};

describe("Decision Logic - Direct Overlap", () => {
  it("returns inside_both_parties when request is within both parties' availability", () => {
    const result = decide({
      date: "2026-01-15",
      start: "10:00",
      end: "11:00",
      requesterTimeZone: "America/New_York",
      partyA: mockPartyA,
      partyB: mockPartyB,
      now: "2025-01-01T00:00:00Z",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.slots).toHaveLength(1);
      expect(result.slots[0].reason).toBe("inside_both_parties");
    }
  });

  it("returns no_overlap when request is outside intersection", () => {
    const result = decide({
      date: "2026-01-15",
      start: "15:00",
      end: "16:00",
      requesterTimeZone: "America/New_York",
      partyA: mockPartyA,
      partyB: mockPartyB,
      now: "2025-01-01T00:00:00Z",
    });
    expect(result).toEqual(expect.objectContaining({ ok: false, error: "no_overlap" }));
  });
});

describe("Decision Logic - Blackout & Validation", () => {
  it("returns blackout when request date is in blackout list", () => {
    const result = decide({
      date: "2026-01-15",
      start: "10:00",
      end: "11:00",
      requesterTimeZone: "America/New_York",
      partyA: mockPartyA,
      partyB: mockPartyB,
      now: "2025-01-01T00:00:00Z",
      blackoutDates: ["2026-01-15"],
    });
    expect(result).toEqual(expect.objectContaining({ ok: false, error: "blackout" }));
  });

  it("returns invalid_interval when start >= end", () => {
    const result = decide({
      date: "2026-01-15",
      start: "11:00",
      end: "10:00",
      requesterTimeZone: "America/New_York",
      partyA: mockPartyA,
      partyB: mockPartyB,
      now: "2025-01-01T00:00:00Z",
    });
    expect(result).toEqual(expect.objectContaining({ ok: false, error: "invalid_interval" }));
  });
});