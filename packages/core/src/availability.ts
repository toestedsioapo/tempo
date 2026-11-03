import { adjustmentNotes, applyBlackouts, contains, expandInstances, mergeSpans } from "./intervals.js";
import type { Instance, Span } from "./intervals.js";
import { inBlackout, outsideAvailability } from "./reasons.js";
import type { LocalDate, PartyRules, Reason } from "./types.js";

export type ParticipantAvailability =
  | { pass: true; match: Instance }
  | { pass: false; reasonCode: "OUTSIDE_AVAILABILITY" | "IN_BLACKOUT"; blockedDate: LocalDate | null };

function assess(party: PartyRules, span: Span): { availability: ParticipantAvailability; open: Instance[] } {
  const all = expandInstances(party, span.startMs, span.endMs);
  const open = applyBlackouts(all, party.blackouts);
  if (contains(mergeSpans(open), span)) {
    // Instances come sorted by start. The span is inside a merged open span, so its start lies in at
    // least one open instance (closed intervals).
    const match = open.find((i) => i.startMs <= span.startMs && span.startMs <= i.endMs) as Instance;
    return { availability: { pass: true, match }, open };
  }
  if (!contains(mergeSpans(all), span)) {
    return { availability: { pass: false, reasonCode: "OUTSIDE_AVAILABILITY", blockedDate: null }, open };
  }
  const [blocked] = all
    .filter((i) => party.blackouts.includes(i.ownerDate) && i.startMs < span.endMs && i.endMs > span.startMs)
    .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  // Invariant: the span is non-empty (G33) and is not covered by open instances but is covered by all,
  // so at least one blacked-out instance overlaps it.
  const blockedDate = (blocked as Instance).ownerDate;
  return { availability: { pass: false, reasonCode: "IN_BLACKOUT", blockedDate }, open };
}

/** SPEC §4.3 / §4.6 for one participant; `match` is the §3.6 `ruleMatched` instance. */
export function checkParticipant(party: PartyRules, span: Span): ParticipantAvailability {
  return assess(party, span).availability;
}

/** SPEC §3.5: the failure reason (if any), then DST_RULE_ADJUSTED notes (A-61). */
export function participantReasons(party: PartyRules, span: Span): { failed: boolean; reasons: Reason[] } {
  const { availability: a, open } = assess(party, span);
  const notes = adjustmentNotes(party, open, span);
  if (a.pass) return { failed: false, reasons: notes };
  const failure =
    a.reasonCode === "IN_BLACKOUT" ? inBlackout(party.partyId, a.blockedDate as LocalDate) : outsideAvailability(party.partyId);
  return { failed: true, reasons: [failure, ...notes] };
}
