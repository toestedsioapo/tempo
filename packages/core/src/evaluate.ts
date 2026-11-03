import { DateTime } from "luxon";
import { findDstError } from "./dst.js";
import { adjustmentNotes, applyBlackouts, contains, expandInstances, findInvalidInterval, mergeSpans } from "./intervals.js";
import { internalError } from "./internal-error.js";
import type { Instance, Span } from "./intervals.js";
import { guardedRun } from "./guard.js";
import { requestedSpan, timeGate } from "./gates.js";
import { formatUtc, toIsoSlot } from "./render.js";
import { inBlackout, inPast, insufficientNotice, outsideAvailability } from "./reasons.js";
import type { NegotiationRequest, NegotiationResult, PartyRules, Reason, ResolvedNegotiationRequest } from "./types.js";
import { validateZones } from "./zones.js";

// partyIds are unique (schema), so two distinct ids never compare equal.
const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : 1);

function failureReason(party: PartyRules, span: Span, all: readonly Instance[], open: readonly Instance[]): Reason | null {
  if (contains(mergeSpans(open), span)) return null;
  if (!contains(mergeSpans(all), span)) return outsideAvailability(party.partyId);
  const [blocked] = all
    .filter((i) => party.blackouts.includes(i.ownerDate) && i.startMs < span.endMs && i.endMs > span.startMs)
    .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  // Invariant: the span is non-empty (G33) and is not covered by open instances but is covered by all,
  // so at least one blacked-out instance overlaps it.
  return inBlackout(party.partyId, (blocked as Instance).ownerDate);
}

/** SPEC 3.5: the failure reason (if any), then DST_RULE_ADJUSTED notes (A-61). */
function participantReasons(party: PartyRules, span: Span): { failed: boolean; reasons: Reason[] } {
  const all = expandInstances(party, span.startMs, span.endMs);
  const open = applyBlackouts(all, party.blackouts);
  const failure = failureReason(party, span, all, open);
  const notes = adjustmentNotes(party, open, span);
  return { failed: failure !== null, reasons: failure ? [failure, ...notes] : notes };
}

function compute(request: ResolvedNegotiationRequest): NegotiationResult {
  const zoneError = validateZones(request);
  if (zoneError) return zoneError;
  const intervalError = findInvalidInterval(request);
  if (intervalError) return intervalError;

  const dstError = findDstError(request);
  if (dstError) return dstError;

  const span = requestedSpan(request.request);
  if (!(span.startMs < span.endMs)) return internalError();
  const requested = toIsoSlot(span, request.request.timeZone);
  const nowMs = DateTime.fromISO(request.options.now, { zone: "utc" }).toMillis();

  const reasons: Reason[] = [];
  let failed = false;
  const gate = timeGate(span.startMs, nowMs, request.options.minNoticeMinutes);
  if (gate === "IN_PAST") {
    failed = true;
    reasons.push(inPast(requested.startUtc, request.options.now));
  } else if (gate === "INSUFFICIENT_NOTICE") {
    failed = true;
    const bound = formatUtc(nowMs + request.options.minNoticeMinutes * 60_000);
    reasons.push(insufficientNotice(requested.startUtc, request.options.minNoticeMinutes, bound));
  }

  const parties = [...request.participants].sort((a, b) => byCodeUnit(a.partyId, b.partyId));
  for (const party of parties) {
    const r = participantReasons(party, span);
    if (r.failed) failed = true;
    reasons.push(...r.reasons);
  }

  if (!failed) return { ok: true, decision: "book", requested, slots: [requested], reasons };
  // Counter-offer slots arrive with suggest() (A-52).
  return { ok: true, decision: "counter_offer", requested, slots: [], reasons };
}

/**
 * SPEC §4.1. Typed for callers, but parses and validates at runtime (A-54, G32): untyped or
 * cast input yields INVALID_INPUT. Errors are values (D13): never throws; exceptions are split by G33 (see guard.ts).
 */
export function evaluate(input: NegotiationRequest): NegotiationResult {
  return guardedRun(input, compute);
}
