/**
 * @tempo/core - Zod schemas matching SPEC.md
 */

import { z } from "zod";
import type { PartyRules, Interval, NegotiationRequest, NegotiationResult, IsoSlot, ErrorResult } from "./types";

export const PartyRulesSchema = z.object({
  partyId: z.string(),
  zone: z.string(),
  availability: z.array(z.object({ start: z.string(), end: z.string() })),
  minimumNoticeMinutes: z.number().default(0),
});

export const IntervalSchema = z.object({ start: z.string(), end: z.string() });

export const NegotiationRequestSchema = z.object({
  date: z.string(),
  start: z.string(),
  end: z.string(),
  requesterTimeZone: z.string(),
  partyA: PartyRulesSchema,
  partyB: PartyRulesSchema,
  now: z.string(),
});

export const ErrorResultSchema = z.object({
  ok: z.literal(false),
  error: z.union([z.literal("invalid_interval"), z.literal("no_overlap"), z.literal("blackout"), z.literal("counter_offer")]),
});

export const IsoSlotSchema = z.object({
  start: z.string(),
  end: z.string(),
});

export const NegotiationResultSchema = z.object({
  ok: z.literal(true),
  slots: z.array(IsoSlotSchema),
});

export type { PartyRules, Interval, NegotiationRequest, NegotiationResult, IsoSlot, ErrorResult };

export function getRulesJsonSchema() {
  return PartyRulesSchema;
}