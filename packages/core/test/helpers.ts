import fc from "fast-check";
import { DateTime } from "luxon";
import type { OracleInput } from "./oracle/oracle.js";

/** Test-only helpers. The EX-01 input as untyped JSON. */
export function validRequest(): unknown {
  const weeklyRules = { monday: [{ start: "09:00", end: "17:00" }] };
  return {
    request: { date: "2025-01-06", start: "09:30", end: "10:30", timeZone: "America/New_York" },
    participants: [
      { partyId: "alice", timeZone: "America/New_York", weeklyRules },
      { partyId: "bob", timeZone: "Europe/London", weeklyRules },
    ],
    options: { now: "2025-01-03T12:00:00Z" },
  };
}

/** Deep clone of `validRequest()` with one value set; `undefined` deletes the key. */
export function withChange(path: readonly (string | number)[], value: unknown): unknown {
  const root = validRequest() as Record<string | number, unknown>;
  let node = root;
  for (const key of path.slice(0, -1)) node = node[key] as Record<string | number, unknown>;
  const last = path[path.length - 1] as string | number;
  if (value === undefined) delete node[last];
  else node[last] = value;
  return root;
}

// ---------------------------------------------------------------------------------------------
// ORC-01 generators (TEST_PLAN §4, E18, G-03 … G-05). Every generated input is valid and stays
// more than one day away from any DST transition of every zone involved: the oracle does not
// model the A-07 overlap policy (earlier occurrence; oracle.ts header, A-55, G34).
// ---------------------------------------------------------------------------------------------

/** A generated input: valid for both `evaluate` (cast) and `oracleDecision`. */
export type DifferentialInput = OracleInput;

/** E18 zones. */
export const GEN_ZONES = [
  "America/New_York",
  "Europe/Berlin",
  "Australia/Sydney",
  "Australia/Lord_Howe",
  "Asia/Manila",
  "Asia/Kolkata",
  "Asia/Kathmandu",
  "UTC",
] as const;

const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;
const PARTY_IDS = ["ana", "bo", "cy", "dee", "eli", "fay"] as const;
const MIN_MS = 60_000;
const HOUR_MS = 3_600_000;
const FIRST_DATE = DateTime.fromISO("2024-01-01", { zone: "utc" });
const DATE_SPAN_DAYS = 4 * 365;

const pad = (n: number): string => String(n).padStart(2, "0");
/** Minutes since midnight (0 … 1439) -> "HH:mm". */
export const hhmm = (minutes: number): string => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
const wallMinutes = (dt: DateTime): number => dt.hour * 60 + dt.minute;

/** True iff `zone`'s UTC offset is constant over [fromMs, toMs] (hourly scan; no transition is shorter). */
export function offsetConstant(zone: string, fromMs: number, toMs: number): boolean {
  const first = DateTime.fromMillis(fromMs, { zone }).offset;
  for (let t = fromMs; t <= toMs + HOUR_MS; t += HOUR_MS) {
    if (DateTime.fromMillis(Math.min(t, toMs), { zone }).offset !== first) return false;
  }
  return true;
}

/**
 * The request lies inside [date 00:00, date+2 00:00) in the request zone, so a transition-free
 * window from one day before that to one day after it puts every request instant more than one
 * day from any transition of every zone.
 */
export function farFromTransitions(date: string, requestZone: string, zones: readonly string[]): boolean {
  const d0 = DateTime.fromISO(date, { zone: requestZone });
  const from = d0.minus({ days: 1 }).toMillis();
  const to = d0.plus({ days: 3 }).toMillis();
  return [requestZone, ...zones].every((z) => offsetConstant(z, from, to));
}

type Rule = { start: string; end: string };
type Weekly = Partial<Record<(typeof DAYS)[number], Rule[]>>;

const weekdayOf = (dt: DateTime): (typeof DAYS)[number] => DAYS[dt.weekday - 1] as (typeof DAYS)[number];

/** Minute-of-day biased toward the small hours (G-02 shape) and quarter hours. */
const minuteOfDayArb = fc.oneof(
  fc.integer({ min: 0, max: 239 }),
  fc.integer({ min: 0, max: 95 }).map((q) => q * 15),
  fc.integer({ min: 0, max: 1439 }),
);

/** G-03: one free-standing rule: same-day, overnight, "00:00" overnight end, or "24:00" end. */
const randomRuleArb: fc.Arbitrary<Rule> = fc.oneof(
  fc
    .tuple(fc.integer({ min: 0, max: 1438 }), fc.integer({ min: 1, max: 1439 }))
    .map(([s, len]) => ({ start: hhmm(s), end: hhmm(Math.min(1439, s + len)) }))
    .filter((r) => r.end > r.start),
  fc.tuple(fc.integer({ min: 1, max: 1439 }), fc.integer({ min: 0, max: 1438 })).map(([s, e]) => ({
    start: hhmm(s),
    end: hhmm(e % s),
  })),
  minuteOfDayArb.map((s) => ({ start: hhmm(s), end: "24:00" })),
);

/** G-03: random extra rules; days may be missing, empty, or hold several rules. */
const randomWeeklyArb: fc.Arbitrary<Weekly> = fc
  .array(
    fc.tuple(fc.constantFrom(...DAYS), fc.array(randomRuleArb, { maxLength: 2 })),
    { maxLength: 3 },
  )
  .map((entries) => {
    const out: Weekly = {};
    for (const [day, rules] of entries) out[day] = [...(out[day] ?? []), ...rules];
    return out;
  });

/**
 * A chain of rules covering [from, to] in the party's local wall time, cut into pieces of less
 * than 24 h. Pieces touch (G-03 touching / split shifts), may overlap the next piece, become
 * overnight rules when they cross midnight, and end at "24:00" or "00:00" when they end at
 * midnight. With `cutAtMidnight` every local midnight inside the span is also a cut, so the chain
 * splits there into a "...-24:00" (or "...-00:00") rule touching a next-day "00:00-..." rule; random
 * cuts alone land on midnight about once in 1,800. Each piece is owned by the local date it
 * starts on (SPEC §4.3).
 */
function coverWeekly(
  from: DateTime,
  to: DateTime,
  cuts: readonly number[],
  overlaps: readonly number[],
  use2400: boolean,
  cutAtMidnight: boolean,
): Weekly {
  const total = Math.round((to.toMillis() - from.toMillis()) / MIN_MS);
  const midnights: number[] = [];
  if (cutAtMidnight) {
    for (let m = from.startOf("day").plus({ days: 1 }); m.toMillis() < to.toMillis(); m = m.plus({ days: 1 })) {
      midnights.push(Math.round((m.toMillis() - from.toMillis()) / MIN_MS));
    }
  }
  const inner = [...cuts, ...midnights].filter((c) => c > 0 && c < total);
  const points = [...new Set([0, ...inner, total])].sort((a, b) => a - b);
  // Keep every piece shorter than 24 h (split long pieces in half until they fit).
  for (let i = 0; i + 1 < points.length; ) {
    const a = points[i] as number;
    const b = points[i + 1] as number;
    if (b - a >= 1440) points.splice(i + 1, 0, a + Math.floor((b - a) / 2));
    else i++;
  }
  const out: Weekly = {};
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i] as number;
    const extend = overlaps[i] ?? 0;
    const b = Math.min((points[i + 1] as number) + extend, a + 1439);
    const s = from.plus({ minutes: a });
    const e = from.plus({ minutes: b });
    const endText = wallMinutes(e) === 0 && use2400 ? "24:00" : hhmm(wallMinutes(e));
    const day = weekdayOf(s);
    out[day] = [...(out[day] ?? []), { start: hhmm(wallMinutes(s)), end: endText }];
  }
  return out;
}

/**
 * True iff some participant has a rule ending at midnight ("24:00", or "00:00" overnight) on
 * weekday W touching a rule that starts at "00:00" on weekday W+1 (G-03: touching + 24:00 +
 * start-day ownership, SPEC §4.3).
 */
export function hasMidnightTouchingChain(input: DifferentialInput): boolean {
  return input.participants.some((p) =>
    DAYS.some((day, i) => {
      const next = DAYS[(i + 1) % 7] as (typeof DAYS)[number];
      const endsAtMidnight = (p.weeklyRules[day] ?? []).some((r) => r.end === "24:00" || r.end === "00:00");
      return endsAtMidnight && (p.weeklyRules[next] ?? []).some((r) => r.start === "00:00");
    }),
  );
}

function mergeWeekly(a: Weekly, b: Weekly): Weekly {
  const out: Weekly = { ...a };
  for (const day of DAYS) {
    const extra = b[day];
    if (extra !== undefined) out[day] = [...(out[day] ?? []), ...extra];
  }
  return out;
}

const formatNow = (ms: number): string =>
  DateTime.fromMillis(ms, { zone: "utc" }).toFormat("yyyy-MM-dd'T'HH:mm:ss'Z'");

interface Base {
  zone: string;
  date: string;
  startMin: number;
  durMin: number;
  ids: string[];
  zones: string[];
  bookish: boolean;
}

const baseArb: fc.Arbitrary<Base> = fc
  .record({
    zone: fc.constantFrom(...GEN_ZONES),
    dayIndex: fc.integer({ min: 0, max: DATE_SPAN_DAYS }),
    startMin: minuteOfDayArb,
    // G-05: 15 min … 23 h 59 min, biased toward short meetings.
    durMin: fc.oneof(fc.integer({ min: 15, max: 240 }), fc.integer({ min: 15, max: 1439 })),
    ids: fc.uniqueArray(fc.constantFrom(...PARTY_IDS), { minLength: 2, maxLength: 4 }),
    zones: fc.array(fc.constantFrom(...GEN_ZONES), { minLength: 4, maxLength: 4 }),
    // About half the inputs are built to fit (so the property is not vacuous); the rest are free.
    bookish: fc.boolean(),
  })
  .map(({ dayIndex, zones, ids, ...rest }) => ({
    ...rest,
    ids,
    zones: zones.slice(0, ids.length),
    date: FIRST_DATE.plus({ days: dayIndex }).toISODate() as string,
  }))
  .filter((b) => farFromTransitions(b.date, b.zone, b.zones));

function participantArb(
  partyId: string,
  zone: string,
  startMs: number,
  endMs: number,
  bookish: boolean,
): fc.Arbitrary<OracleInput["participants"][number]> {
  const ls = DateTime.fromMillis(startMs, { zone });
  const le = DateTime.fromMillis(endMs, { zone });
  const slack = fc.oneof(fc.constant(0), fc.integer({ min: 1, max: 180 }));
  const coverArb = fc
    .record({
      before: slack,
      after: slack,
      cuts: fc.array(fc.integer({ min: 1, max: 1800 }), { maxLength: 3 }),
      overlaps: fc.array(fc.oneof(fc.constant(0), fc.integer({ min: 1, max: 60 })), { maxLength: 4 }),
      use2400: fc.boolean(),
      cutAtMidnight: fc.boolean(),
    })
    .map(({ before, after, cuts, overlaps, use2400, cutAtMidnight }) =>
      coverWeekly(ls.minus({ minutes: before }), le.plus({ minutes: after }), cuts, overlaps, use2400, cutAtMidnight),
    );
  // G-04: owner dates, the day after, and dates that differ between UTC and the party's zone.
  const candidates = [
    ...new Set([
      ls.toISODate() as string,
      ls.plus({ days: 1 }).toISODate() as string,
      ls.minus({ days: 1 }).toISODate() as string,
      le.toISODate() as string,
      DateTime.fromMillis(startMs, { zone: "utc" }).toISODate() as string,
      DateTime.fromMillis(endMs, { zone: "utc" }).toISODate() as string,
    ]),
  ];
  const pct = bookish ? 3 : 25;
  const blackoutsArb = fc
    .tuple(fc.array(fc.integer({ min: 0, max: 99 }), { minLength: candidates.length, maxLength: candidates.length }), fc.boolean())
    .map(([rolls, omitEmpty]) => {
      const picked = candidates.filter((_, i) => (rolls[i] ?? 100) < pct);
      return picked.length === 0 && omitEmpty ? undefined : picked;
    });
  return fc
    .record({
      cover: bookish ? coverArb.map((w) => w as Weekly | null) : fc.option(coverArb, { freq: 3 }),
      extra: randomWeeklyArb,
      blackouts: blackoutsArb,
    })
    .map(({ cover, extra, blackouts }) => ({
      partyId,
      timeZone: zone,
      weeklyRules: cover === null ? extra : mergeWeekly(cover, extra),
      ...(blackouts === undefined ? {} : { blackouts }),
    }));
}

/** C8 gate inputs: `now` (to the second) and an optional notice, including the equality edges. */
function optionsArb(startMs: number, bookish: boolean): fc.Arbitrary<OracleInput["options"]> {
  const leadSec = bookish
    ? fc.oneof(fc.constant(0), fc.integer({ min: 0, max: 7 * 86400 }), fc.integer({ min: 0, max: 7 * 1440 }).map((m) => m * 60))
    : fc.oneof(
        fc.constant(0),
        fc.constantFrom(-1, 1, -60, 60),
        fc.integer({ min: -86400, max: 7 * 86400 }),
        fc.integer({ min: 0, max: 7 * 1440 }).map((m) => m * 60),
      );
  return leadSec.chain((lead) => {
    const maxFit = Math.max(0, Math.floor(lead / 60));
    const notice = bookish
      ? fc.option(fc.oneof(fc.constant(maxFit), fc.integer({ min: 0, max: maxFit })), { nil: undefined })
      : fc.option(
          fc.oneof(fc.constant(maxFit), fc.constant(maxFit + 1), fc.integer({ min: 0, max: 2880 })),
          { nil: undefined },
        );
    return notice.map((n) => ({
      now: formatNow(startMs - lead * 1000),
      ...(n === undefined ? {} : { minNoticeMinutes: n }),
    }));
  });
}

/** ORC-01 input generator. `searchHorizonDays` is left at its default and unused. */
export function differentialInputArb(): fc.Arbitrary<DifferentialInput> {
  return baseArb.chain((b) => {
    const request = {
      date: b.date,
      start: hhmm(b.startMin),
      end: hhmm((b.startMin + b.durMin) % 1440),
      timeZone: b.zone,
    };
    const startDt = DateTime.fromISO(`${b.date}T${request.start}`, { zone: b.zone });
    const startMs = startDt.toMillis();
    const endMs = startDt.plus({ minutes: b.durMin }).toMillis();
    const parts = b.ids.map((id, i) => participantArb(id, b.zones[i] as string, startMs, endMs, b.bookish));
    return fc
      .tuple(fc.tuple(...parts), optionsArb(startMs, b.bookish))
      .map(([participants, options]) => ({ request, participants, options }));
  });
}
