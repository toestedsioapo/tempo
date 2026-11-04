// Every ErrorCode and ReasonCode in SPEC §3 is produced by at least one labelled input here
// (ROADMAP M2b DoD). A new member of either enum fails this file until a producer is added.
import { afterEach, describe, expect, it, vi } from "vitest";
import { evaluate, explain } from "../src/index.js";
import type { NegotiationRequest } from "../src/index.js";
import { CheckReasonCodeSchema, ErrorCodeSchema, ReasonCodeSchema } from "../src/schema.js";
import { validRequest, withChange } from "./helpers.js";

const req = (x: unknown) => x as NegotiationRequest;
const open24 = { partyId: "z", timeZone: "UTC", weeklyRules: Object.fromEntries(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].map((d) => [d, [{ start: "00:00", end: "24:00" }]])) };

/** Labelled inputs; `error` ones expect that code, `reason` ones expect it among `reasons`. */
const ERROR_INPUTS: Record<string, unknown> = {
  INVALID_INPUT: {},
  INVALID_ZONE: withChange(["request", "timeZone"], "Mars/Olympus_Mons"),
  AMBIGUOUS_ZONE: withChange(["request", "timeZone"], "IST"),
  INVALID_INTERVAL: withChange(["participants", 0, "weeklyRules"], { monday: [{ start: "09:00", end: "09:00" }] }),
  DST_NONEXISTENT_LOCAL_TIME: {
    request: { date: "2025-03-09", start: "02:30", end: "03:30", timeZone: "America/New_York" },
    participants: [open24, { ...open24, partyId: "y" }],
    options: { now: "2025-03-01T00:00:00Z" },
  },
  DST_AMBIGUOUS_LOCAL_TIME: {
    request: { date: "2025-11-02", start: "01:30", end: "03:00", timeZone: "America/New_York" },
    participants: [open24, { ...open24, partyId: "y" }],
    options: { now: "2025-10-01T00:00:00Z" },
  },
};

const REASON_INPUTS: Record<string, unknown> = {
  IN_PAST: withChange(["options", "now"], "2025-01-07T00:00:00Z"),
  INSUFFICIENT_NOTICE: withChange(["options", "minNoticeMinutes"], 100_000),
  OUTSIDE_AVAILABILITY: withChange(["request", "start"], "08:30"),
  IN_BLACKOUT: withChange(["participants", 0, "blackouts"], ["2025-01-06"]),
  NO_SLOTS_IN_HORIZON: {
    request: { date: "2025-01-06", start: "10:00", end: "11:00", timeZone: "UTC" },
    participants: [{ partyId: "a", timeZone: "UTC", weeklyRules: {} }, open24],
    options: { now: "2025-01-03T00:00:00Z", searchHorizonDays: 1 },
  },
  DST_RULE_ADJUSTED: {
    request: { date: "2025-03-09", start: "03:00", end: "03:15", timeZone: "America/New_York" },
    participants: [
      { partyId: "a", timeZone: "America/New_York", weeklyRules: { sunday: [{ start: "02:30", end: "10:00" }] } },
      open24,
    ],
    options: { now: "2025-03-01T00:00:00Z" },
  },
};

describe("every ErrorCode is produced by a labelled input", () => {
  const produced = new Set<string>();
  it.each(Object.entries(ERROR_INPUTS))("%s", (code, input) => {
    for (const fn of [evaluate, explain]) {
      const r = fn(req(input));
      expect(r.ok === false && r.error.code).toBe(code);
    }
    produced.add(code);
  });

  it("INTERNAL_ERROR (the mock path of Task 2) is the only code not produced by plain input", () => {
    expect(ErrorCodeSchema.options.filter((c) => !(c in ERROR_INPUTS))).toEqual(["INTERNAL_ERROR"]);
  });
});

describe("every ReasonCode is produced by a labelled input", () => {
  it.each(Object.entries(REASON_INPUTS))("%s", (code, input) => {
    for (const fn of [evaluate, explain]) {
      const r = fn(req(input));
      expect(r.ok && r.reasons.map((x) => x.code)).toContain(code);
    }
  });

  it("the labelled sets cover the schema enums exactly", () => {
    expect(Object.keys(REASON_INPUTS).sort()).toEqual([...ReasonCodeSchema.options].sort());
    expect(Object.keys(ERROR_INPUTS).sort()).toEqual(ErrorCodeSchema.options.filter((c) => c !== "INTERNAL_ERROR").sort());
  });
});

describe("explain-only check codes", () => {
  it("OK, OUTSIDE_AVAILABILITY and IN_BLACKOUT all appear in traces", () => {
    const seen = new Set<string>();
    for (const input of [validRequest(), REASON_INPUTS["OUTSIDE_AVAILABILITY"], REASON_INPUTS["IN_BLACKOUT"]]) {
      const r = explain(req(input));
      if (r.ok) for (const c of r.requested.checks) seen.add(c.reasonCode);
    }
    expect([...seen].sort()).toEqual([...CheckReasonCodeSchema.options].sort());
  });
});

describe("INTERNAL_ERROR via the mocked search path", () => {
  afterEach(() => {
    vi.doUnmock("../src/search.js");
    vi.resetModules();
  });

  it.each(["evaluate", "suggest", "explain"] as const)("%s returns INTERNAL_ERROR as a value", async (name) => {
    vi.resetModules();
    vi.doMock("../src/search.js", () => ({
      searchSlots: () => {
        throw new Error("boom");
      },
    }));
    const mod = await import("../src/index.js");
    const r = mod[name](req(withChange(["request", "start"], "08:30")));
    expect(r.ok === false && r.error.code).toBe("INTERNAL_ERROR");
  });
});
