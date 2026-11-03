import { DateTime } from "luxon";
import { wallTimeToMs } from "./dst.js";
import type { Span } from "./intervals.js";
import type { ClockTime, LocalDate, ResolvedNegotiationRequest } from "./types.js";

export type TimeGate = "OK" | "IN_PAST" | "INSUFFICIENT_NOTICE";

type RequestBody = ResolvedNegotiationRequest["request"];
type Wall = { date: LocalDate; time: ClockTime };

/** SPEC §4.4 (C7): `end` is on `date` if later than start, else on the next date. */
export function requestWallTimes(request: RequestBody): { start: Wall; end: Wall } {
  const endDate =
    request.end > request.start
      ? request.date
      : (DateTime.fromISO(request.date, { zone: "utc" }).plus({ days: 1 }).toISODate() as LocalDate);
  return {
    start: { date: request.date, time: request.start },
    end: { date: endDate, time: request.end },
  };
}

export function requestedSpan(request: RequestBody): Span {
  const { start, end } = requestWallTimes(request);
  return {
    startMs: wallTimeToMs(start.date, start.time, request.timeZone),
    endMs: wallTimeToMs(end.date, end.time, request.timeZone),
  };
}

/** SPEC §4.5 (C8): start == now and start == now + notice both pass. */
export function timeGate(startMs: number, nowMs: number, minNoticeMinutes: number): TimeGate {
  if (startMs < nowMs) return "IN_PAST";
  if (startMs < nowMs + minNoticeMinutes * 60_000) return "INSUFFICIENT_NOTICE";
  return "OK";
}
