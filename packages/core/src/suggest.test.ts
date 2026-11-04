import { afterEach, describe, expect, it, vi } from "vitest";
import { validRequest } from "../test/helpers.js";
import { evaluate } from "./evaluate.js";
import { internalError } from "./internal-error.js";
import { suggest } from "./suggest.js";
import type { NegotiationRequest, NegotiationResult } from "./types.js";

const codes = (r: NegotiationResult) => (r.ok ? r.reasons.map((x) => `${x.code}:${x.participantId ?? ""}`) : []);
const startsUtc = (r: NegotiationResult) => (r.ok ? r.slots.map((s) => s.startUtc) : null);

describe("CORE-30 suggest on a bookable request (A-66)", () => {
  it("slots[0] is the requested slot, then ranked non-overlapping alternatives", () => {
    const r = suggest(validRequest() as NegotiationRequest);
    expect(r.ok && r.decision).toBe("book");
    if (!r.ok) return;
    expect(r.slots[0]).toEqual(r.requested);
    expect(r.reasons).toEqual([]);
    expect(startsUtc(r)).toEqual(["2025-01-06T14:30:00Z", "2025-01-06T15:30:00Z", "2025-01-13T14:00:00Z"]);
  });

  it("maxSuggestions 1 gives just the requested slot", () => {
    const input = validRequest() as { options: Record<string, unknown> };
    input.options.maxSuggestions = 1;
    const r = suggest(input as unknown as NegotiationRequest);
    expect(r.ok && r.slots).toEqual(r.ok ? [r.requested] : null);
  });

  it("evaluate on the same request keeps slots: [requested]", () => {
    const r = evaluate(validRequest() as NegotiationRequest);
    expect(r.ok && r.slots).toEqual(r.ok ? [r.requested] : null);
  });
});

describe("suggest on a counter_offer matches evaluate", () => {
  it("same result", () => {
    const input = validRequest() as { request: Record<string, unknown> };
    input.request.start = "08:30";
    input.request.end = "09:30";
    const a = suggest(input as unknown as NegotiationRequest);
    expect(a.ok && a.decision).toBe("counter_offer");
    expect(a).toEqual(evaluate(input as unknown as NegotiationRequest));
  });
});

describe("CORE-31 reason order with NO_SLOTS_IN_HORIZON last", () => {
  // alice: sunday 02:30-04:30 NY (02:30 is in the 2025-03-09 gap); bob: no rules at all.
  const input = (horizon?: number): NegotiationRequest =>
    ({
      request: { date: "2025-03-09", start: "04:00", end: "05:00", timeZone: "America/New_York" },
      participants: [
        { partyId: "bob", timeZone: "UTC", weeklyRules: {} },
        { partyId: "alice", timeZone: "America/New_York", weeklyRules: { sunday: [{ start: "02:30", end: "04:30" }] } },
      ],
      options: { now: "2025-03-10T00:00:00Z", ...(horizon ? { searchHorizonDays: horizon } : {}) },
    }) as NegotiationRequest;

  it.each([
    ["evaluate", evaluate],
    ["suggest", suggest],
  ] as const)("%s", (_n, fn) => {
    const r = fn(input());
    expect(codes(r)).toEqual([
      "IN_PAST:",
      "OUTSIDE_AVAILABILITY:alice",
      "DST_RULE_ADJUSTED:alice",
      "OUTSIDE_AVAILABILITY:bob",
      "NO_SLOTS_IN_HORIZON:",
    ]);
    expect(r.ok && r.slots).toEqual([]);
    expect(r.ok && r.reasons.at(-1)).toEqual({
      code: "NO_SLOTS_IN_HORIZON",
      message: "No slot found within 14 days of the requested start.",
    });
  });

  it("the message carries searchHorizonDays", () => {
    const r = evaluate(input(3));
    expect(r.ok && r.reasons.at(-1)?.message).toBe("No slot found within 3 days of the requested start.");
  });
});

describe("suggest never throws (D13, G33)", () => {
  afterEach(() => {
    vi.doUnmock("./search.js");
    vi.resetModules();
  });

  it("hostile input is INVALID_INPUT", () => {
    const r = suggest(null as unknown as NegotiationRequest);
    expect(r.ok === false && r.error.code).toBe("INVALID_INPUT");
  });

  it("an exception during the search is INTERNAL_ERROR", async () => {
    vi.resetModules();
    vi.doMock("./search.js", () => ({
      searchSlots: () => {
        throw new Error("secret");
      },
    }));
    const mod = await import("./suggest.js");
    const r = mod.suggest(validRequest() as NegotiationRequest);
    expect(r).toEqual(internalError());
  });
});
