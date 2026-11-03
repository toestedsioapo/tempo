import { DateTime } from "luxon";
import { findDstError } from "./dst.js";
import { applyBlackouts, contains, expandInstances, findInvalidInterval, mergeSpans } from "./intervals.js";
import { internalError } from "./internal-error.js";
import type { Span } from "./intervals.js";
import { parseNegotiationRequest } from "./parse.js";
import { requestedSpan, timeGate } from "./gates.js";
import { formatUtc, toIsoSlot } from "./render.js";
import { inBlackout, inPast, insufficientNotice, outsideAvailability } from "./reasons.js";
import type { NegotiationRequest, NegotiationResult, PartyRules, Reason, ResolvedNegotiationRequest } from "./types.js";
import { validateZones } from "./zones.js";

// partyIds are unique (schema), so two distinct ids never compare equal.
const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : 1);

function participantReason(party: PartyRules, span: Span): Reason | null {
  const all = expandInstances(party, span.startMs, span.endMs);
  const open = applyBlackouts(all, party.blackouts);
  if (contains(mergeSpans(open), span)) return null;
  if (!contains(mergeSpans(all), span)) return outsideAvailability(party.partyId);
  const blocked = all
    .filter((i) => party.blackouts.includes(i.ownerDate) && i.startMs < span.endMs && i.endMs > span.startMs)
    .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs)[0];
  // The span is non-empty (G33), so a blacked-out instance overlapping it exists here.
  return inBlackout(party.partyId, (blocked as NonNullable<typeof blocked>).ownerDate);
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
  const gate = timeGate(span.startMs, nowMs, request.options.minNoticeMinutes);
  if (gate === "IN_PAST") reasons.push(inPast(requested.startUtc, request.options.now));
  else if (gate === "INSUFFICIENT_NOTICE") {
    const bound = formatUtc(nowMs + request.options.minNoticeMinutes * 60_000);
    reasons.push(insufficientNotice(requested.startUtc, request.options.minNoticeMinutes, bound));
  }

  const parties = [...request.participants].sort((a, b) => byCodeUnit(a.partyId, b.partyId));
  for (const party of parties) {
    const reason = participantReason(party, span);
    if (reason) reasons.push(reason);
  }

  if (reasons.length === 0) return { ok: true, decision: "book", requested, slots: [requested], reasons: [] };
  // Counter-offer slots arrive with suggest() (A-52).
  return { ok: true, decision: "counter_offer", requested, slots: [], reasons };
}

/**
 * SPEC §4.1. Typed for callers, but parses and validates at runtime (A-54, G32): untyped or
 * cast input yields INVALID_INPUT. Errors are values (D13): never throws.
 */
export function evaluate(input: NegotiationRequest): NegotiationResult {
  try {
    const parsed = parseNegotiationRequest(input);
    if (!parsed.ok) return parsed;
    return compute(parsed.value);
  } catch {
    const message = "Input could not be read.";
    return {
      ok: false,
      error: { code: "INVALID_INPUT", message, details: { issues: [{ path: "$", message }] } },
    };
  }
}
