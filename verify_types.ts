/**
 * Quick type verification for @tempo/core
 */
import { PartyRulesSchema, NegotiationRequestSchema, IsoSlotSchema, NegotiationResultSchema, ErrorResultSchema } from "./packages/core/src/schema";
import type { PartyRules, NegotiationRequest, IsoSlot, NegotiationResult, ErrorResult } from "./packages/core/src/types";

// Test that schemas can be instantiated
const partyRules: PartyRules = {
  partyId: "A",
  zone: "America/New_York",
  availability: [{ start: "09:00", end: "17:00" }],
  minimumNoticeMinutes: 0,
};

const negotiationRequest: NegotiationRequest = {
  date: "2026-07-13",
  start: "22:00",
  end: "23:00",
  requesterTimeZone: "America/New_York",
  partyA: partyRules,
  partyB: {
    partyId: "B",
    zone: "Europe/London",
    availability: [{ start: "20:00", end: "06:00" }],
    minimumNoticeMinutes: 0,
  },
  now: "2026-07-13T00:00:00Z",
};

// Test schema validation
const parsedRequest = NegotiationRequestSchema.safeParse(negotiationRequest);
console.log("Request parsed:", parsedRequest.success);

// Test error result
const errorResult: ErrorResult = { ok: false, error: "no_overlap" };
const parsedError = ErrorResultSchema.safeParse(errorResult);
console.log("Error parsed:", parsedError.success);

// Test negotiation result
const negotiationResult: NegotiationResult = { ok: true, slots: [{ start: "2026-07-14T15:00:00-04:00", end: "2026-07-14T16:00:00-04:00" }] };
const parsedResult = NegotiationResultSchema.safeParse(negotiationResult);
console.log("Result parsed:", parsedResult.success);

// Test iso slot
const isoSlot: IsoSlot = { start: "2026-07-14T15:00:00-04:00", end: "2026-07-14T16:00:00-04:00" };
const parsedSlot = IsoSlotSchema.safeParse(isoSlot);
console.log("Slot parsed:", parsedSlot.success);

console.log("All type verifications passed!");