import fc from "fast-check";
import { DateTime } from "luxon";
import type { OracleInput } from "./oracle/oracle.js";

// ---------------------------------------------------------------------------------------------
// Generators G-01 … G-05 (TEST_PLAN §4, E18). Every generated input is schema-valid. At least half
// of the dates fall within ±2 days of a DST transition of a zone involved (G-01), at least half of
// the request times are in 00:00-04:00 (G-02), and requests may land in a gap or overlap: the
// engine must then return the C10 error the oracle predicts (A-64).
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
const FIRST_DATE = DateTime.fromISO("2024-01-01", { zone: "utc" });
const DATE_SPAN_DAYS = 4 * 365;

const pad = (n: number): string => String(n).padStart(2, "0");
/** Minutes since midnight (0 … 1439) -> "HH:mm". */
export const hhmm = (minutes: number): string => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
const wallMinutes = (dt: DateTime): number => dt.hour * 60 + dt.minute;

/** G-01: the zone-local dates (within the generated date range) on which `zone`'s offset changes. */
const transitionCache = new Map<string, string[]>();
export function transitionDates(zone: string): string[] {
  const hit = transitionCache.get(zone);
  if (hit) return hit;
  const out: string[] = [];
  let prev = FIRST_DATE.setZone(zone).startOf("day");
  for (let i = 1; i <= DATE_SPAN_DAYS + 3; i++) {
    const next = FIRST_DATE.plus({ days: i }).setZone(zone).startOf("day");
    if (next.offset !== prev.offset) out.push(prev.toISODate() as string);
    prev = next;
  }
  transitionCache.set(zone, out);
  return out;
}

const uniformDateArb: fc.Arbitrary<string> = fc
  .integer({ min: 0, max: DATE_SPAN_DAYS })
  .map((n) => FIRST_DATE.plus({ days: n }).toISODate() as string);

/**
 * G-01: a date within ±2 days of a transition of one of `zones` (when any has transitions in the
 * range), otherwise uniform. Half of all dates come from here.
 */
export function dateNearTransitionArb(zones: readonly string[]): fc.Arbitrary<string> {
  const all = zones.flatMap((z) => transitionDates(z));
  if (all.length === 0) return uniformDateArb;
  return fc
    .tuple(fc.constantFrom(...all), fc.integer({ min: -2, max: 2 }))
    .map(([d, delta]) => DateTime.fromISO(d, { zone: "utc" }).plus({ days: delta }).toISODate() as string);
}

/** E18 zone arbitrary. */
export const zoneArb: fc.Arbitrary<(typeof GEN_ZONES)[number]> = fc.constantFrom(...GEN_ZONES);

type Rule = { start: string; end: string };
type Weekly = Partial<Record<(typeof DAYS)[number], Rule[]>>;

const weekdayOf = (dt: DateTime): (typeof DAYS)[number] => DAYS[dt.weekday - 1] as (typeof DAYS)[number];

/** Minute-of-day biased toward the small hours (G-02 shape) and quarter hours. */
const minuteOfDayArb = fc.oneof(
  { weight: 2, arbitrary: fc.integer({ min: 60, max: 239 }) },
  { weight: 1, arbitrary: fc.integer({ min: 0, max: 59 }) },
  { weight: 1, arbitrary: fc.integer({ min: 0, max: 95 }).map((q) => q * 15) },
  { weight: 2, arbitrary: fc.integer({ min: 0, max: 1439 }) },
);
/** G-02: at least half of the wall times are in 00:00-04:00 (minute of day 0 … 239). */
export const wallTimeArb: fc.Arbitrary<string> = minuteOfDayArb.map(hhmm);
/** G-05: 15 min … 23 h 59 min, biased toward short meetings. */
export const durationArb: fc.Arbitrary<number> = fc.oneof(
  fc.integer({ min: 15, max: 240 }),
  fc.integer({ min: 15, max: 1439 }),
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
export const rulesArb: fc.Arbitrary<Weekly> = fc
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
    zone: zoneArb,
    startMin: minuteOfDayArb,
    durMin: durationArb,
    ids: fc.uniqueArray(fc.constantFrom(...PARTY_IDS), { minLength: 2, maxLength: 4 }),
    zones: fc.array(zoneArb, { minLength: 4, maxLength: 4 }),
    // About half the inputs are built to fit (so the property is not vacuous); the rest are free.
    bookish: fc.boolean(),
  })
  .chain(({ zones, ids, zone, ...rest }) => {
    const used = zones.slice(0, ids.length);
    return fc
      .oneof(
        { weight: 2, arbitrary: dateNearTransitionArb([zone]) },
        { weight: 4, arbitrary: dateNearTransitionArb([zone, ...used]) },
        { weight: 1, arbitrary: uniformDateArb },
      )
      .map((date) => ({ ...rest, zone, ids, zones: used, date }));
  });

/** G-04: each candidate date is blacked out with probability `pct` %; an empty list may be omitted. */
export function blackoutsArb(candidates: readonly string[], pct: number): fc.Arbitrary<string[] | undefined> {
  return fc
    .tuple(fc.array(fc.integer({ min: 0, max: 99 }), { minLength: candidates.length, maxLength: candidates.length }), fc.boolean())
    .map(([rolls, omitEmpty]) => {
      const picked = candidates.filter((_, i) => (rolls[i] ?? 100) < pct);
      return picked.length === 0 && omitEmpty ? undefined : picked;
    });
}

/** Rules that repeat every day, so every date (and every transition date) sees them (G-03). */
const everyDay = (rules: Rule[]): Weekly => Object.fromEntries(DAYS.map((d) => [d, rules]));

/** Wide-open days: many slots exist inside the horizon (exercises ranking, greedy and caps). */
const broadArb: fc.Arbitrary<Weekly> = fc
  .tuple(fc.integer({ min: 0, max: 480 }), fc.integer({ min: 900, max: 1440 }))
  .map(([s, e]) => everyDay([{ start: hhmm(s), end: e === 1440 ? "24:00" : hhmm(e) }]));

/** Daily rules whose edges sit in 01:00-03:30 quarter hours: boundaries land in gaps and overlaps (G34, A-07). */
const transitionHourArb: fc.Arbitrary<Weekly> = fc
  .tuple(fc.integer({ min: 4, max: 14 }), fc.integer({ min: 1, max: 40 }))
  .map(([q, len]) => {
    const end = Math.min(1440, (q + len) * 15);
    return everyDay([{ start: hhmm(q * 15), end: end === 1440 ? "24:00" : hhmm(end) }]);
  });

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
  const blackoutList = blackoutsArb(candidates, bookish ? 3 : 25);
  return fc
    .record({
      cover: bookish ? coverArb.map((w) => w as Weekly | null) : fc.option(coverArb, { freq: 3 }),
      extra: rulesArb,
      broad: fc.option(broadArb, { freq: 3, nil: null }),
      shifty: fc.option(transitionHourArb, { freq: 3, nil: null }),
      blackouts: blackoutList,
    })
    .map(({ cover, extra, broad, shifty, blackouts }) => ({
      partyId,
      timeZone: zone,
      weeklyRules: [cover ?? {}, extra, broad ?? {}, shifty ?? {}].reduce(mergeWeekly),
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
    return fc
      .tuple(
        notice,
        fc.integer({ min: 1, max: 3 }),
        // 7 does not divide 24 h; 1 stresses the lattice (G-04 of the plan: step anchored at rs).
        fc.constantFrom(1, 5, 7, 15, 15, 30, 60),
        fc.integer({ min: 1, max: 6 }),
      )
      .map(([n, searchHorizonDays, searchStepMinutes, maxSuggestions]) => ({
        now: formatNow(startMs - lead * 1000),
        ...(n === undefined ? {} : { minNoticeMinutes: n }),
        searchHorizonDays,
        searchStepMinutes,
        maxSuggestions,
      }));
  });
}

/** Valid negotiation requests (ORC-01, INV-*): horizon 1 … 3 days so the oracle stays cheap. */
export function negotiationInputArb(): fc.Arbitrary<DifferentialInput> {
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

/** G-04 blackout dates for a party: owner dates of the span, the day after, and UTC-vs-local differences. */
export function blackoutDatesFor(input: DifferentialInput, partyIndex: number): string[] {
  const p = input.participants[partyIndex] as DifferentialInput["participants"][number];
  const start = DateTime.fromISO(`${input.request.date}T${input.request.start}`, { zone: input.request.timeZone });
  return [
    ...new Set([
      start.setZone(p.timeZone).toISODate() as string,
      start.setZone(p.timeZone).plus({ days: 1 }).toISODate() as string,
      start.setZone(p.timeZone).minus({ days: 1 }).toISODate() as string,
      start.setZone("utc").toISODate() as string,
    ]),
  ];
}

const DST_ZONES = ["America/New_York", "Europe/Berlin", "Australia/Sydney", "Australia/Lord_Howe"] as const;

/**
 * A directed generator for the G34 / A-07 / C10 paths: one party in a DST zone with a daily rule whose
 * edges are quarter hours in 01:00-04:00 (so a boundary lands in the gap or the repeated hour on the
 * transition date), a request on or next to that date in the small hours, in the party's zone or UTC.
 */
export function dstFocusedInputArb(): fc.Arbitrary<DifferentialInput> {
  return fc
    .record({
      zone: fc.constantFrom(...DST_ZONES),
      pick: fc.nat(),
      delta: fc.constantFrom(-1, 0, 0, 0, 1),
      ruleStart: fc.integer({ min: 4, max: 16 }).map((q) => q * 15),
      ruleLen: fc.integer({ min: 1, max: 32 }).map((q) => q * 15),
      reqStart: fc.integer({ min: 0, max: 24 }).map((q) => q * 15),
      reqLen: fc.integer({ min: 1, max: 40 }).map((q) => q * 15),
      inUtc: fc.boolean(),
      third: fc.boolean(),
      thirdZone: zoneArb,
      blackout: fc.boolean(),
      horizon: fc.integer({ min: 1, max: 2 }),
      step: fc.constantFrom(5, 15, 30),
      maxSuggestions: fc.integer({ min: 1, max: 4 }),
    })
    .map((c) => {
      const dates = transitionDates(c.zone);
      const base = dates[c.pick % dates.length] as string;
      const date = DateTime.fromISO(base, { zone: "utc" }).plus({ days: c.delta }).toISODate() as string;
      const ruleEnd = (c.ruleStart + c.ruleLen) % 1440;
      const rule = { start: hhmm(c.ruleStart), end: hhmm(ruleEnd) };
      const reqEndMin = (c.reqStart + c.reqLen) % 1440;
      const participants: DifferentialInput["participants"] = [
        {
          partyId: "alice",
          timeZone: c.zone,
          weeklyRules: everyDay([rule]),
          ...(c.blackout ? { blackouts: [DateTime.fromISO(date, { zone: "utc" }).minus({ days: 1 }).toISODate() as string] } : {}),
        },
        { partyId: "bob", timeZone: "UTC", weeklyRules: everyDay([{ start: "00:00", end: "24:00" }]) },
      ];
      if (c.third) participants.push({ partyId: "carol", timeZone: c.thirdZone, weeklyRules: everyDay([{ start: "00:00", end: "24:00" }]) });
      return {
        request: { date, start: hhmm(c.reqStart), end: hhmm(reqEndMin), timeZone: c.inUtc ? "UTC" : c.zone },
        participants,
        options: {
          now: "2020-01-01T00:00:00Z",
          searchHorizonDays: c.horizon,
          searchStepMinutes: c.step,
          maxSuggestions: c.maxSuggestions,
        },
      };
    });
}
