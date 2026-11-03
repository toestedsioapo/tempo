import { DateTime } from "luxon";
import { wallTimeToMs } from "./intervals.js";
import type { Span } from "./intervals.js";
import type { LocalDate, ResolvedNegotiationRequest } from "./types.js";

export type TimeGate = "OK" | "IN_PAST" | "INSUFFICIENT_NOTICE";

/** SPEC §4.4 (C7): end on the same date if later than start, else the next date. */
export function requestedSpan(request: ResolvedNegotiationRequest["request"]): Span {
  const startMs = wallTimeToMs(request.date, request.start, request.timeZone);
  const endDate =
    request.end > request.start
      ? request.date
      : (DateTime.fromISO(request.date, { zone: "utc" }).plus({ days: 1 }).toISODate() as LocalDate);
  return { startMs, endMs: wallTimeToMs(endDate, request.end, request.timeZone) };
}

/** SPEC §4.5 (C8): start == now and start == now + notice both pass. */
export function timeGate(startMs: number, nowMs: number, minNoticeMinutes: number): TimeGate {
  if (startMs < nowMs) return "IN_PAST";
  if (startMs < nowMs + minNoticeMinutes * 60_000) return "INSUFFICIENT_NOTICE";
  return "OK";
}
