import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { dstRuleAdjusted, inBlackout, inPast, insufficientNotice, outsideAvailability } from "./reasons.js";

describe("reason templates (SPEC 3.5)", () => {
  it("IN_PAST", () =>
    expect(inPast("2025-01-06T14:30:00Z", "2025-01-06T14:30:01Z")).toEqual({
      code: "IN_PAST",
      message: "Requested start 2025-01-06T14:30:00Z is before now 2025-01-06T14:30:01Z.",
    }));
  it("INSUFFICIENT_NOTICE", () =>
    expect(insufficientNotice("2025-01-06T14:30:00Z", 120, "2025-01-06T15:00:00Z")).toEqual({
      code: "INSUFFICIENT_NOTICE",
      message:
        "Requested start 2025-01-06T14:30:00Z is earlier than now plus 120 minutes (2025-01-06T15:00:00Z).",
    }));
  it("OUTSIDE_AVAILABILITY", () =>
    expect(outsideAvailability("alice")).toEqual({
      code: "OUTSIDE_AVAILABILITY",
      participantId: "alice",
      message: "alice: requested interval is not inside any availability interval.",
    }));
  it("IN_BLACKOUT", () =>
    expect(inBlackout("bob", "2025-01-06")).toEqual({
      code: "IN_BLACKOUT",
      participantId: "bob",
      message: "bob: availability is blocked by blackout date 2025-01-06.",
    }));
  it("DST_RULE_ADJUSTED", () =>
    expect(
      dstRuleAdjusted(
        "bob",
        { boundary: "start", localTime: "2025-03-09T02:30", kind: "nonexistent", resolvedMs: DateTime.fromISO("2025-03-09T07:00:00Z").toMillis() },
        "America/New_York",
      ),
    ).toEqual({
      code: "DST_RULE_ADJUSTED",
      participantId: "bob",
      message: "bob: rule boundary 2025-03-09T02:30 in America/New_York is nonexistent; resolved to 2025-03-09T07:00:00Z.",
    }));
});
