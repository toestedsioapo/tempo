import { checkParticipant } from "./availability.js";
import { decide } from "./evaluate.js";
import type { Decision } from "./evaluate.js";
import { guardedRun } from "./guard.js";
import { timeGate } from "./gates.js";
import type { Span } from "./intervals.js";
import type {
  CandidateTrace,
  ExplainResult,
  IsoSlot,
  NegotiationRequest,
  ParticipantCheck,
} from "./types.js";

function trace(d: Decision, span: Span, slot: IsoSlot): CandidateTrace {
  const gate = timeGate(span.startMs, d.nowMs, d.noticeMinutes);
  // `d.parties` is already sorted by partyId in code-unit order (SPEC §3.6).
  const checks: ParticipantCheck[] = d.parties.map((party) => {
    const a = checkParticipant(party, span);
    if (!a.pass) {
      return { participant: party.partyId, ruleMatched: null, pass: false, reasonCode: a.reasonCode };
    }
    const { weekday, rule, ownerDate } = a.match;
    return {
      participant: party.partyId,
      ruleMatched: { weekday, start: rule.start, end: rule.end, ownerDate },
      pass: true,
      reasonCode: "OK",
    };
  });
  return { slot, pass: gate === "OK" && checks.every((c) => c.pass), timeGate: gate, checks };
}

/**
 * SPEC §3.6 / D15: the same decision as `evaluate`, with a per-participant trace of the requested
 * slot and of each counter-offer slot. Never throws (D13, G33).
 */
export function explain(input: NegotiationRequest): ExplainResult {
  return guardedRun(input, (request) => {
    const d = decide(request, false);
    if ("error" in d) return d;
    return {
      ok: true as const,
      decision: d.failed ? ("counter_offer" as const) : ("book" as const),
      reasons: [...d.reasons],
      requested: trace(d, d.span, d.requested),
      candidates: d.failed ? d.found.map((f) => trace(d, f.span, f.slot)) : [],
    };
  });
}
