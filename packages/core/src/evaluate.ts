import { DateTime } from "luxon";
import { participantReasons } from "./availability.js";
import { findDstError } from "./dst.js";
import { findInvalidInterval } from "./intervals.js";
import { internalError } from "./internal-error.js";
import { guardedRun } from "./guard.js";
import { requestedSpan, timeGate } from "./gates.js";
import { formatUtc, toIsoSlot } from "./render.js";
import { inPast, insufficientNotice, noSlotsInHorizon } from "./reasons.js";
import { searchSlots } from "./search.js";
import type { NegotiationResult, NegotiationRequest, Reason, ResolvedNegotiationRequest } from "./types.js";
import { validateZones } from "./zones.js";

// partyIds are unique (schema), so two distinct ids never compare equal.
const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : 1);

/**
 * Shared engine for `evaluate` and `suggest` (SPEC §3.3, A-66). They differ only on `book`:
 * `evaluate` returns `slots: [requested]`, `suggest` the ranked search (requested first, distance 0).
 */
export function negotiate(request: ResolvedNegotiationRequest, mode: "evaluate" | "suggest"): NegotiationResult {
  const zoneError = validateZones(request);
  if (zoneError) return zoneError;
  const intervalError = findInvalidInterval(request);
  if (intervalError) return intervalError;

  const dstError = findDstError(request);
  if (dstError) return dstError;

  const span = requestedSpan(request.request);
  if (!(span.startMs < span.endMs)) return internalError();
  const { options } = request;
  const zone = request.request.timeZone;
  const requested = toIsoSlot(span, zone);
  const nowMs = DateTime.fromISO(options.now, { zone: "utc" }).toMillis();
  const boundMs = nowMs + options.minNoticeMinutes * 60_000;

  const reasons: Reason[] = [];
  let failed = false;
  const gate = timeGate(span.startMs, nowMs, options.minNoticeMinutes);
  if (gate === "IN_PAST") {
    failed = true;
    reasons.push(inPast(requested.startUtc, options.now));
  } else if (gate === "INSUFFICIENT_NOTICE") {
    failed = true;
    reasons.push(insufficientNotice(requested.startUtc, options.minNoticeMinutes, formatUtc(boundMs)));
  }

  const parties = [...request.participants].sort((a, b) => byCodeUnit(a.partyId, b.partyId));
  for (const party of parties) {
    const r = participantReasons(party, span);
    if (r.failed) failed = true;
    reasons.push(...r.reasons);
  }

  if (!failed && mode === "evaluate") return { ok: true, decision: "book", requested, slots: [requested], reasons };

  const slots = searchSlots({
    requested: span,
    boundMs,
    parties,
    horizonDays: options.searchHorizonDays,
    stepMinutes: options.searchStepMinutes,
    maxSuggestions: options.maxSuggestions,
  }).map((s) => toIsoSlot(s, zone));

  if (!failed) return { ok: true, decision: "book", requested, slots, reasons };
  if (slots.length === 0) reasons.push(noSlotsInHorizon(options.searchHorizonDays));
  return { ok: true, decision: "counter_offer", requested, slots, reasons };
}

/**
 * SPEC §4.1. Typed for callers, but parses and validates at runtime (A-54, G32): untyped or
 * cast input yields INVALID_INPUT. Errors are values (D13): never throws; exceptions are split by G33 (see guard.ts).
 */
export function evaluate(input: NegotiationRequest): NegotiationResult {
  return guardedRun(input, (request) => negotiate(request, "evaluate"));
}
