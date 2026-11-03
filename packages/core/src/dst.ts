import { DateTime } from "luxon";
import { requestWallTimes } from "./gates.js";
import { formatOffset, formatUtc } from "./render.js";
import type { ClockTime, EndTime, ErrorResult, LocalDate, ResolvedNegotiationRequest, ZoneId } from "./types.js";

export type WallInstant = { readonly ms: number; readonly offsetMinutes: number };
export type WallClassification = {
  /** Ascending by `ms`: 0 (gap), 1 (normal) or 2 (overlap). */
  readonly instants: readonly WallInstant[];
  /** Zone offsets at `W - 24h` and `W + 24h` (A-62: at most one change in that window). */
  readonly offsetBeforeMinutes: number;
  readonly offsetAfterMinutes: number;
  /** First instant the new offset applies; non-null iff `instants.length !== 1`. */
  readonly transitionMs: number | null;
};

const DAY_MS = 24 * 3600_000;
const MIN_MS = 60_000;

const offsetAt = (t: number, zone: ZoneId): number => DateTime.fromMillis(t, { zone }).offset;

/** Bisects the offset change between `lo` (old offset) and `hi` (new offset) to the minute. */
function findTransition(lo: number, hi: number, offsetAfter: number, zone: ZoneId): number {
  let a = lo;
  let b = hi;
  while (b - a > MIN_MS) {
    const mid = a + Math.floor((b - a) / 2 / MIN_MS) * MIN_MS;
    if (offsetAt(mid, zone) === offsetAfter) b = mid;
    else a = mid;
  }
  return b;
}

/**
 * Classifies a wall reading in `zone` (A-53, A-62). Does not rely on Luxon's default
 * gap/overlap resolution. "24:00" means the next date at 00:00.
 */
export function classifyWallTime(date: LocalDate, time: ClockTime | EndTime, zone: ZoneId): WallClassification {
  const base = DateTime.fromISO(date, { zone: "utc" });
  const wall =
    time === "24:00"
      ? base.plus({ days: 1 })
      : base.set({ hour: Number(time.slice(0, 2)), minute: Number(time.slice(3, 5)) });
  const w = wall.toMillis();
  const offsetBeforeMinutes = offsetAt(w - DAY_MS, zone);
  const offsetAfterMinutes = offsetAt(w + DAY_MS, zone);
  const instants: WallInstant[] = [];
  for (const o of new Set([offsetBeforeMinutes, offsetAfterMinutes])) {
    const ms = w - o * MIN_MS;
    if (offsetAt(ms, zone) === o) instants.push({ ms, offsetMinutes: o });
  }
  instants.sort((x, y) => x.ms - y.ms);
  const transitionMs =
    instants.length === 1 ? null : findTransition(w - DAY_MS, w + DAY_MS, offsetAfterMinutes, zone);
  return { instants, offsetBeforeMinutes, offsetAfterMinutes, transitionMs };
}

/**
 * Wall reading -> instant (A-53, G34): overlap -> earlier instant; gap -> the transition
 * instant (first instant after the gap).
 */
export function wallTimeToMs(date: LocalDate, time: ClockTime | EndTime, zone: ZoneId): number {
  const c = classifyWallTime(date, time, zone);
  const first = c.instants[0];
  return first !== undefined ? first.ms : (c.transitionMs as number);
}

function dstErrorFor(
  field: "request.start" | "request.end",
  wall: { date: LocalDate; time: ClockTime },
  zone: ZoneId,
): ErrorResult | null {
  const c = classifyWallTime(wall.date, wall.time, zone);
  const localTime = `${wall.date}T${wall.time}`;
  if (c.instants.length === 0) {
    return {
      ok: false,
      error: {
        code: "DST_NONEXISTENT_LOCAL_TIME",
        message: `${localTime} does not exist in ${zone} (clocks skip forward).`,
        details: {
          field,
          localTime,
          timeZone: zone,
          transitionUtc: formatUtc(c.transitionMs as number),
          offsetBefore: formatOffset(c.offsetBeforeMinutes),
          offsetAfter: formatOffset(c.offsetAfterMinutes),
        },
      },
    };
  }
  if (c.instants.length === 2) {
    return {
      ok: false,
      error: {
        code: "DST_AMBIGUOUS_LOCAL_TIME",
        message: `${localTime} occurs twice in ${zone} (clocks fall back).`,
        details: {
          field,
          localTime,
          timeZone: zone,
          candidates: c.instants.map((i) => ({ utc: formatUtc(i.ms), offset: formatOffset(i.offsetMinutes) })),
        },
      },
    };
  }
  return null;
}

/** C10 (SPEC §4.1 step 4): rejects a nonexistent or ambiguous request start, then end. */
export function findDstError(request: ResolvedNegotiationRequest): ErrorResult | null {
  const zone = request.request.timeZone;
  const { start, end } = requestWallTimes(request.request);
  return dstErrorFor("request.start", start, zone) ?? dstErrorFor("request.end", end, zone);
}
