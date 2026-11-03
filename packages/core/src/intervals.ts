import { DateTime } from "luxon";
import { DAY_NAMES } from "./schema.js";
import type {
  ClockTime,
  DayName,
  EndTime,
  ErrorResult,
  Interval,
  LocalDate,
  PartyRules,
  ResolvedNegotiationRequest,
  ZoneId,
} from "./types.js";

export type Span = { readonly startMs: number; readonly endMs: number };
export type Instance = Span & {
  readonly ownerDate: LocalDate;
  readonly weekday: DayName;
  readonly rule: Interval;
};

const DAY_MS = 24 * 3600_000;
const MIN_MS = 60_000;

const offsetAt = (t: number, zone: ZoneId): number => DateTime.fromMillis(t, { zone }).offset;

/**
 * Wall reading -> instant, with Tempo's own DST policy (A-53): overlap -> earlier instant,
 * gap -> forward using the pre-transition offset. Does not rely on Luxon's default resolution.
 * "24:00" means the next date at 00:00.
 */
export function wallTimeToMs(date: LocalDate, time: ClockTime | EndTime, zone: ZoneId): number {
  const base = DateTime.fromISO(date, { zone: "utc" });
  const wall = time === "24:00" ? base.plus({ days: 1 }) : base.set({
    hour: Number(time.slice(0, 2)),
    minute: Number(time.slice(3, 5)),
  });
  const w = wall.toMillis();
  const oBefore = offsetAt(w - DAY_MS, zone);
  const oAfter = offsetAt(w + DAY_MS, zone);
  const valid: number[] = [];
  for (const o of new Set([oBefore, oAfter])) {
    const t = w - o * MIN_MS;
    if (offsetAt(t, zone) === o) valid.push(t);
  }
  if (valid.length > 0) return Math.min(...valid);
  return w - oBefore * MIN_MS;
}

export function expandInstances(party: PartyRules, fromMs: number, toMs: number): Instance[] {
  const zone = party.timeZone;
  let day = DateTime.fromMillis(fromMs, { zone }).startOf("day").minus({ days: 2 });
  const last = DateTime.fromMillis(toMs, { zone }).startOf("day").plus({ days: 1 });
  const out: Instance[] = [];
  while (day.toMillis() <= last.toMillis()) {
    const ownerDate = day.toISODate() as LocalDate;
    const weekday = DAY_NAMES[day.weekday - 1] as DayName;
    for (const rule of party.weeklyRules[weekday] ?? []) {
      const nextDate = day.plus({ days: 1 }).toISODate() as LocalDate;
      const startMs = wallTimeToMs(ownerDate, rule.start, zone);
      const endMs =
        rule.end === "24:00" || rule.end < rule.start
          ? wallTimeToMs(nextDate, rule.end === "24:00" ? "00:00" : rule.end, zone)
          : wallTimeToMs(ownerDate, rule.end, zone);
      out.push({ startMs, endMs, ownerDate, weekday, rule });
    }
    day = day.plus({ days: 1 });
  }
  return out.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
}

export function applyBlackouts(instances: readonly Instance[], blackouts: readonly LocalDate[]): Instance[] {
  const set = new Set<string>(blackouts);
  return instances.filter((i) => !set.has(i.ownerDate));
}

/** Merges overlapping or touching spans (closed intervals, A-16). */
export function mergeSpans(spans: readonly Span[]): Span[] {
  const sorted = [...spans].sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  const out: Span[] = [];
  for (const s of sorted) {
    const cur = out[out.length - 1];
    if (cur !== undefined && s.startMs <= cur.endMs) {
      if (s.endMs > cur.endMs) out[out.length - 1] = { startMs: cur.startMs, endMs: s.endMs };
    } else out.push({ startMs: s.startMs, endMs: s.endMs });
  }
  return out;
}

export function contains(merged: readonly Span[], span: Span): boolean {
  return merged.some((m) => m.startMs <= span.startMs && span.endMs <= m.endMs);
}

export function findInvalidInterval(request: ResolvedNegotiationRequest): ErrorResult | null {
  for (const [pi, p] of request.participants.entries()) {
    for (const day of DAY_NAMES) {
      for (const [ii, r] of (p.weeklyRules[day] ?? []).entries()) {
        if (r.start === r.end) {
          return {
            ok: false,
            error: {
              code: "INVALID_INTERVAL",
              message: "Availability interval start and end must differ.",
              details: { field: `participants[${pi}].weeklyRules.${day}[${ii}]`, start: r.start, end: r.end },
            },
          };
        }
      }
    }
  }
  return null;
}
