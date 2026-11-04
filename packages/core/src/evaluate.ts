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
import type { Span } from "./intervals.js";
import type {
  ErrorResult,
  IsoSlot,
  NegotiationRequest,
  NegotiationResult,
  PartyRules,
  Reason,
  ResolvedNegotiationRequest,
} from "./types.js";
import { validateZones } from "./zones.js";

// partyIds are unique (schema), so two distinct ids never compare equal.
const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : 1);

/** Everything the three entry points share: the requested slot, the SPEC §3.5 reasons and the search result. */
export interface Decision {
  readonly span: Span;
  readonly requested: IsoSlot;
  readonly nowMs: number;
  readonly noticeMinutes: number;
  readonly gate: ReturnType<typeof timeGate>;
  /** Parties sorted by partyId code-unit order. */
  readonly parties: readonly PartyRules[];
  readonly failed: boolean;
  readonly reasons: readonly Reason[];
  /** Ranked search result as rendered slots, plus the spans they came from. */
  readonly slots: readonly IsoSlot[];
  readonly spans: readonly Span[];
}

/**
 * The single decision pipeline (SPEC §4.1 validation order, §3.5 reasons, §4.7 search) behind
 * `evaluate`, `suggest` and `explain`. `searchOnBook` is true only for `suggest` (A-66): on a
 * `book`, `evaluate`/`explain` skip the search and `slots` is `[requested]`.
 */
export function decide(request: ResolvedNegotiationRequest, searchOnBook: boolean): Decision | ErrorResult {
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

  const base = { span, requested, nowMs, noticeMinutes: options.minNoticeMinutes, gate, parties, failed };
  if (!failed && !searchOnBook) return { ...base, reasons, slots: [requested], spans: [span] };

  const spans = searchSlots({
    requested: span,
    boundMs,
    parties,
    horizonDays: options.searchHorizonDays,
    stepMinutes: options.searchStepMinutes,
    maxSuggestions: options.maxSuggestions,
  });
  const slots = spans.map((s) => toIsoSlot(s, zone));
  if (failed && slots.length === 0) reasons.push(noSlotsInHorizon(options.searchHorizonDays));
  return { ...base, reasons, slots, spans };
}

/** `evaluate`/`suggest` result from a decision (SPEC §3.3). */
export function negotiate(request: ResolvedNegotiationRequest, mode: "evaluate" | "suggest"): NegotiationResult {
  const d = decide(request, mode === "suggest");
  if ("error" in d) return d;
  return {
    ok: true,
    decision: d.failed ? "counter_offer" : "book",
    requested: d.requested,
    slots: [...d.slots],
    reasons: [...d.reasons],
  };
}

/**
 * SPEC §4.1. Typed for callers, but parses and validates at runtime (A-54, G32): untyped or
 * cast input yields INVALID_INPUT. Errors are values (D13): never throws; exceptions are split by G33 (see guard.ts).
 */
export function evaluate(input: NegotiationRequest): NegotiationResult {
  return guardedRun(input, (request) => negotiate(request, "evaluate"));
}
