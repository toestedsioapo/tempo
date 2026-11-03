import { DateTime } from "luxon";
import { classifyWallTime } from "./dst.js";
import { dstRuleAdjusted } from "./reasons.js";
import { DAY_NAMES } from "./schema.js";
import type {
  ClockTime,
  DayName,
  ErrorResult,
  Interval,
  LocalDate,
  PartyRules,
  Reason,
  ResolvedNegotiationRequest,
  ZoneId,
} from "./types.js";

export type Span = { readonly startMs: number; readonly endMs: number };
export type Instance = Span & {
  readonly ownerDate: LocalDate;
  readonly weekday: DayName;
  readonly rule: Interval;
  readonly adjustments: readonly BoundaryAdjustment[];
};

/** A rule boundary that fell in a DST gap or overlap and was resolved by G34 / A-07. */
export type BoundaryAdjustment = {
  readonly boundary: "start" | "end";
  /** YYYY-MM-DDTHH:mm */
  readonly localTime: string;
  readonly kind: "nonexistent" | "ambiguous";
  readonly resolvedMs: number;
};

/**
 * G34: a nonexistent boundary resolves to the transition instant, an ambiguous one to the earlier
 * occurrence. Returns null when the resolved instance is empty (endMs <= startMs): it is dropped.
 */
export function resolveInstanceBoundaries(
  ownerDate: LocalDate,
  rule: Interval,
  zone: ZoneId,
): { startMs: number; endMs: number; adjustments: BoundaryAdjustment[] } | null {
  const nextDate = DateTime.fromISO(ownerDate, { zone: "utc" }).plus({ days: 1 }).toISODate() as LocalDate;
  const adjustments: BoundaryAdjustment[] = [];
  const resolve = (boundary: "start" | "end", date: LocalDate, time: ClockTime): number => {
    const c = classifyWallTime(date, time, zone);
    // A gap has no instants, so a transition always exists there (classifyWallTime contract).
    const ms = c.instants[0]?.ms ?? (c.transitionMs as number);
    if (c.instants.length !== 1) {
      adjustments.push({
        boundary,
        localTime: `${date}T${time}`,
        kind: c.instants.length === 0 ? "nonexistent" : "ambiguous",
        resolvedMs: ms,
      });
    }
    return ms;
  };
  const startMs = resolve("start", ownerDate, rule.start);
  const endMs =
    rule.end === "24:00"
      ? resolve("end", nextDate, "00:00")
      : resolve("end", rule.end < rule.start ? nextDate : ownerDate, rule.end);
  return endMs > startMs ? { startMs, endMs, adjustments } : null;
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
      const resolved = resolveInstanceBoundaries(ownerDate, rule, zone);
      if (resolved !== null) out.push({ ...resolved, ownerDate, weekday, rule });
    }
    day = day.plus({ days: 1 });
  }
  return out.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
}

export function applyBlackouts(instances: readonly Instance[], blackouts: readonly LocalDate[]): Instance[] {
  const set = new Set<string>(blackouts);
  return instances.filter((i) => !set.has(i.ownerDate));
}

/**
 * A-61: one DST_RULE_ADJUSTED note per adjusted boundary of each open (non-blacked-out) instance that
 * strictly overlaps the requested span, chronological by resolved instant.
 */
export function adjustmentNotes(party: PartyRules, openInstances: readonly Instance[], span: Span): Reason[] {
  return openInstances
    .filter((i) => i.startMs < span.endMs && i.endMs > span.startMs)
    .flatMap((i) => i.adjustments)
    .sort((a, b) => a.resolvedMs - b.resolvedMs)
    .map((a) => dstRuleAdjusted(party.partyId, a, party.timeZone));
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
