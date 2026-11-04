// Independent brute-force oracle (ORC-01, ORC-02, A-64). Imports ONLY luxon; reuses nothing from the engine.
//
// Model. Time is whole UTC minutes. For a party's zone every minute `t` has a wall reading
// `L(t)` = local-day-number * 1440 + minute-of-day (a monotone-except-at-fall-back timeline).
// A rule owned by local day D, `[start, end)`, is the set of UTC minutes whose wall reading lies in
// `[D*1440 + start, D*1440 + end)` (end on D+1 when end <= start, i.e. overnight; "24:00" = 1440).
// No intervals are converted from wall time to an instant and no boundary table exists: a gap
// boundary is the first minute after the gap by itself (G34), a rule wholly inside a gap is empty.
//
// The one documented exception (A-64) is the fall-back overlap. Pure wall-membership would leave a
// hole inside a repeated hour, so an instance runs from the FIRST minute whose reading is
// >= its start target to the FIRST minute whose reading is >= its end target. That equals
// wall-membership everywhere except across a repeated hour, where it keeps A-07's "earlier
// occurrence" policy and an unbroken instance.
//
// Closed intervals (SPEC 4.3) are modelled as half-open minute ranges that merge when they touch:
// a request [s, e] is inside availability iff minutes s .. e-1 are all covered, which is
// equivalent (touching instances join; a request may end exactly at an availability end).
//
// Search (C9, G22): own lattice scan over rs + k*step, own ranking and own greedy skip-on-overlap.
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
  options: {
    now: string;
    minNoticeMinutes?: number;
    searchHorizonDays?: number;
    searchStepMinutes?: number;
    maxSuggestions?: number;
  };
}

export type OracleGate = "OK" | "IN_PAST" | "INSUFFICIENT_NOTICE";

export interface OracleSlot {
  startMs: number;
  endMs: number;
}

export interface OracleResult {
  decision: "book" | "counter_offer";
  failing: string[];
  gate: OracleGate;
}

export interface OracleSlotsResult extends OracleResult {
  /** Ranked, non-overlapping lattice search result (what `suggest` returns; also `evaluate` on a counter_offer). */
  slots: OracleSlot[];
  requested: OracleSlot;
}

export interface OracleError {
  error: { code: "DST_NONEXISTENT_LOCAL_TIME" | "DST_AMBIGUOUS_LOCAL_TIME"; field: "request.start" | "request.end" };
}

const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const MIN_MS = 60_000;
const DAY_MIN = 1440;

// "HH:mm" or "24:00" -> minutes since midnight.
function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(":");
  return Number(h) * 60 + Number(m);
}

const dayNumberOf = (isoDate: string): number => DateTime.fromISO(isoDate, { zone: "utc" }).toMillis() / 86_400_000;
const isoDateOf = (dayNumber: number): string =>
  DateTime.fromMillis(dayNumber * 86_400_000, { zone: "utc" }).toISODate() as string;

/**
 * Wall readings for UTC minutes [fromMin, toMin): index i holds L(fromMin + i). The zone's offset is
 * read once an hour and bisected where it changes (no zone has two changes within an hour).
 */
function wallTimeline(zone: string, fromMin: number, toMin: number): Float64Array {
  const offsetAt = (m: number): number => DateTime.fromMillis(m * MIN_MS, { zone }).offset;
  const out = new Float64Array(toMin - fromMin);
  const fill = (a: number, b: number, off: number) => {
    for (let m = a; m < b; m++) out[m - fromMin] = m + off;
  };
  for (let a = fromMin; a < toMin; a += 60) {
    const b = Math.min(a + 60, toMin);
    const offA = offsetAt(a);
    const offB = offsetAt(b - 1);
    if (offA === offB) {
      fill(a, b, offA);
      continue;
    }
    let lo = a; // offset(lo) === offA
    let hi = b - 1; // offset(hi) !== offA
    while (hi - lo > 1) {
      const mid = Math.floor((lo + hi) / 2);
      if (offsetAt(mid) === offA) lo = mid;
      else hi = mid;
    }
    fill(a, hi, offA);
    fill(hi, b, offB);
  }
  return out;
}

/** UTC minutes whose wall reading in `zone` is exactly `date hh:mm`: 0 = nonexistent, 2 = ambiguous. */
function instantsForWall(zone: string, date: string, hhmm: string): number[] {
  const target = dayNumberOf(date) * DAY_MIN + minutesOf(hhmm);
  const guess = Math.floor(DateTime.fromISO(`${date}T${hhmm}`, { zone }).toMillis() / MIN_MS);
  const from = guess - 2 * DAY_MIN;
  const timeline = wallTimeline(zone, from, guess + 2 * DAY_MIN);
  const out: number[] = [];
  timeline.forEach((l, i) => {
    if (l === target) out.push(from + i);
  });
  return out;
}

type Party = OracleInput["participants"][number];

/** Merged half-open [start, end) UTC-minute ranges where `party` is open, within [fromMin, toMin). */
function openRanges(party: Party, fromMin: number, toMin: number): [number, number][] {
  const timeline = wallTimeline(party.timeZone, fromMin, toMin);
  const first = (target: number): number => {
    for (let i = 0; i < timeline.length; i++) if ((timeline[i] as number) >= target) return fromMin + i;
    return toMin; // beyond the window; clipped (only far outside the region of interest)
  };
  const blackouts = new Set(party.blackouts ?? []);
  const firstDay = Math.floor((timeline[0] as number) / DAY_MIN) - 1;
  const lastDay = Math.floor((timeline[timeline.length - 1] as number) / DAY_MIN) + 1;
  const ranges: [number, number][] = [];
  for (let d = firstDay; d <= lastDay; d++) {
    if (blackouts.has(isoDateOf(d))) continue;
    const weekday = DAYS[(d + 3) % 7] as string; // day 0 (1970-01-01) was a Thursday
    for (const rule of party.weeklyRules[weekday] ?? []) {
      const s = minutesOf(rule.start);
      const e = minutesOf(rule.end);
      const targetStart = d * DAY_MIN + s;
      const targetEnd = (e > s ? d : d + 1) * DAY_MIN + e;
      const a = first(targetStart);
      const b = first(targetEnd);
      if (b > a) ranges.push([a, b]);
    }
  }
  ranges.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  const merged: [number, number][] = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([r[0], r[1]]);
  }
  return merged;
}

const covers = (ranges: [number, number][], s: number, e: number): boolean =>
  ranges.some(([a, b]) => a <= s && e <= b);

/** The requested span in UTC minutes, or the DST error the engine must return (SPEC 4.1, C10). */
function requestSpan(request: OracleInput["request"]): { startMin: number; endMin: number } | OracleError {
  const endsNextDay = minutesOf(request.end) <= minutesOf(request.start);
  const endDate = endsNextDay ? isoDateOf(dayNumberOf(request.date) + 1) : request.date;
  const check = (date: string, hhmm: string, field: "request.start" | "request.end") => {
    const hits = instantsForWall(request.timeZone, date, hhmm);
    if (hits.length === 1) return hits[0] as number;
    const code = hits.length === 0 ? "DST_NONEXISTENT_LOCAL_TIME" : "DST_AMBIGUOUS_LOCAL_TIME";
    return { error: { code, field } } as OracleError;
  };
  const start = check(request.date, request.start, "request.start");
  if (typeof start !== "number") return start;
  const end = check(endDate, request.end, "request.end");
  if (typeof end !== "number") return end;
  return { startMin: start, endMin: end };
}

/** Which of `spans` (UTC ms, whole minutes) lie inside every participant's availability. */
export function oracleCovers(input: OracleInput, spans: readonly OracleSlot[]): boolean[] {
  if (spans.length === 0) return [];
  const from = Math.min(...spans.map((s) => s.startMs / MIN_MS)) - 2 * DAY_MIN;
  const to = Math.max(...spans.map((s) => s.endMs / MIN_MS)) + 2 * DAY_MIN;
  const per = input.participants.map((p) => openRanges(p, from, to));
  return spans.map((s) => per.every((r) => covers(r, s.startMs / MIN_MS, s.endMs / MIN_MS)));
}

/** Wall-time to instant for tests: the unique UTC instant of `date hh:mm` in `zone`, or null. */
export function oracleInstant(zone: string, date: string, hhmm: string): number | null {
  const hits = instantsForWall(zone, date, hhmm);
  return hits.length === 1 ? (hits[0] as number) * MIN_MS : null;
}

export function oracleSlots(input: OracleInput): OracleSlotsResult | OracleError {
  const span = requestSpan(input.request);
  if ("error" in span) return span;
  const { startMin: rs, endMin: re } = span;
  const duration = re - rs;
  const o = input.options;
  const horizonMin = (o.searchHorizonDays ?? 14) * DAY_MIN;
  const step = o.searchStepMinutes ?? 15;
  const maxSuggestions = o.maxSuggestions ?? 3;

  const nowMs = DateTime.fromISO(o.now, { zone: "utc" }).toMillis();
  // Untyped callers (JSON fixtures) bypass the type; an unreadable `now` would make every
  // comparison false and silently pass the gate, so fail loudly instead.
  if (!Number.isFinite(nowMs)) throw new Error(`oracle: options.now is missing or invalid`);
  const boundMs = nowMs + (o.minNoticeMinutes ?? 0) * MIN_MS;
  const startMs = rs * MIN_MS;
  const gate: OracleGate = startMs < nowMs ? "IN_PAST" : startMs < boundMs ? "INSUFFICIENT_NOTICE" : "OK";

  const from = rs - horizonMin - 2 * DAY_MIN;
  const to = re + horizonMin + 2 * DAY_MIN;
  const ranges = input.participants.map((p) => ({ id: p.partyId, open: openRanges(p, from, to) }));

  const failing = ranges.filter((r) => !covers(r.open, rs, re)).map((r) => r.id);
  failing.sort();

  // Lattice scan: every s_k = rs + k*step with |k*step| <= horizon, ranked by (distance, start).
  const fits: { start: number; distance: number }[] = [];
  const kMax = Math.floor(horizonMin / step);
  for (let k = -kMax; k <= kMax; k++) {
    const s = rs + k * step;
    if (s * MIN_MS < boundMs) continue;
    if (ranges.every((r) => covers(r.open, s, s + duration))) fits.push({ start: s, distance: Math.abs(k * step) });
  }
  fits.sort((a, b) => a.distance - b.distance || a.start - b.start);

  const picked: number[] = [];
  for (const c of fits) {
    if (picked.length >= maxSuggestions) break;
    // Touching slots are fine; only a real overlap is skipped (G22, A-27).
    if (picked.every((p) => c.start >= p + duration || p >= c.start + duration)) picked.push(c.start);
  }

  return {
    decision: gate === "OK" && failing.length === 0 ? "book" : "counter_offer",
    failing,
    gate,
    requested: { startMs, endMs: re * MIN_MS },
    slots: picked.map((s) => ({ startMs: s * MIN_MS, endMs: (s + duration) * MIN_MS })),
  };
}

/** Decision, failing parties and time gate only (ORC-01/02 view). Throws on an error input. */
export function oracleDecision(input: OracleInput): OracleResult {
  const r = oracleSlots(input);
  if ("error" in r) throw new Error(`oracle: request has ${r.error.code} at ${r.error.field}`);
  return { decision: r.decision, failing: r.failing, gate: r.gate };
}
