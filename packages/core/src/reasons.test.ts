import { describe, expect, it } from "vitest";
import { inBlackout, inPast, insufficientNotice, outsideAvailability } from "./reasons.js";

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
});
