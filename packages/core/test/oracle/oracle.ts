// Independent brute-force oracle (ORC-01). Imports ONLY luxon; reuses nothing from the engine.
//
// Method: walk every UTC minute of the request, convert it to each participant's zone with
// Luxon, and ask "does this wall reading fall inside some rule of the owner date that is not a
// blackout?". No intervals are merged and no wall-time -> instant conversion is done for rules.
//
// Closed-interval interpretation (SPEC 4.3): the engine asks whether [s, e] lies in one merged
// closed interval. Rules here are tested half-open on the wall reading (start <= t < end), per
// minute, for minutes s .. e-1. This is equivalent:
//  * touching instances (12:00 end / 12:00 start) join because minute 11:59 is in the first and
//    12:00 in the second, so no uncovered minute exists (EX-07);
//  * the end instant e needs no check of its own: minute e-1 is covered by an instance whose
//    end is a whole minute >= e, so e <= instance.end holds automatically. A request ending
//    exactly at an availability end therefore books, while one minute beyond does not;
//  * a "24:00" end covers every minute up to the next midnight and owns nothing after it.
// Overnight rules (end < start) are owned by the day they start: they cover t >= start on the
// owner date and t < end on the following date.
//
// DST limitation (A-07, A-55): the oracle reads each minute's wall time and so does NOT model the
// A-07 rule-boundary policy (gap boundary -> forward, overlap boundary -> earlier occurrence). It
// diverges from the engine at DST gaps AND at fall-back overlaps, so it must only be used on inputs
// away from transitions. ORC-02 excludes EX-24 for this reason (A-55), and the ORC-01 generators
// keep every request more than one day from any transition of every zone involved.
import { DateTime } from "luxon";

export interface OracleInput {
  request: { date: string; start: string; end: string; timeZone: string };
  participants: {
    partyId: string;
    timeZone: string;
    weeklyRules: Record<string, { start: string; end: string }[] | undefined>;
    blackouts?: string[];
  }[];
  // `now` is required: without it the time gate cannot be evaluated, and a missing value must not
  // silently pass the gate.
  options: { now: string; minNoticeMinutes?: number };
}

export interface OracleResult {
  decision: "book" | "counter_offer";
  failing: string[];
  gate: "OK" | "IN_PAST" | "INSUFFICIENT_NOTICE";
}

const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

// "HH:mm" or "24:00" -> minutes since midnight.
function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(":");
  return Number(h) * 60 + Number(m);
}

function covered(
  p: OracleInput["participants"][number],
  wallDate: DateTime,
  wallMinutes: number,
): boolean {
  const blackouts = p.blackouts ?? [];
  // Candidate owners: this local date, and the previous local date (overnight / 24:00 spill).
  for (const back of [0, 1]) {
    const owner = wallDate.minus({ days: back });
    if (blackouts.includes(owner.toISODate() as string)) continue;
    const weekday = DAYS[owner.weekday - 1] as string;
    for (const rule of p.weeklyRules[weekday] ?? []) {
      const s = minutesOf(rule.start);
      const e = minutesOf(rule.end);
      if (e > s) {
        // Same-day rule (a "24:00" end lands here too: e = 1440, nothing spills past midnight).
        if (back === 0 && wallMinutes >= s && wallMinutes < e) return true;
      } else {
        // Overnight: [s, midnight) on the owner date, [0, e) on the next date.
        if (back === 0 && wallMinutes >= s) return true;
        if (back === 1 && wallMinutes < e) return true;
      }
    }
  }
  return false;
}

export function oracleDecision(input: OracleInput): OracleResult {
  const { request, participants } = input;
  const at = (date: string, hhmm: string) =>
    DateTime.fromISO(`${date}T${hhmm}`, { zone: request.timeZone });
  const startDt = at(request.date, request.start);
  let endDt = at(request.date, request.end);
  if (endDt.toMillis() <= startDt.toMillis()) {
    const next = DateTime.fromISO(request.date, { zone: request.timeZone }).plus({ days: 1 });
    endDt = at(next.toISODate() as string, request.end);
  }
  const startMs = startDt.toMillis();
  const endMs = endDt.toMillis();

  const failing: string[] = [];
  for (const p of participants) {
    let ok = true;
    for (let t = startMs; t < endMs && ok; t += 60_000) {
      const local = DateTime.fromMillis(t, { zone: p.timeZone });
      const day = local.startOf("day");
      if (!covered(p, day, local.hour * 60 + local.minute)) ok = false;
    }
    if (!ok) failing.push(p.partyId);
  }
  failing.sort();

  const nowMs = DateTime.fromISO(input.options.now, { zone: "utc" }).toMillis();
  // Untyped callers (JSON fixtures) bypass the type; an unreadable `now` would make every
  // comparison false and silently pass the gate, so fail loudly instead.
  if (!Number.isFinite(nowMs)) throw new Error(`oracle: options.now is missing or invalid`);
  const boundMs = nowMs + (input.options.minNoticeMinutes ?? 0) * 60_000;
  const gate = startMs < nowMs ? "IN_PAST" : startMs < boundMs ? "INSUFFICIENT_NOTICE" : "OK";

  return {
    decision: gate === "OK" && failing.length === 0 ? "book" : "counter_offer",
    failing,
    gate,
  };
}
