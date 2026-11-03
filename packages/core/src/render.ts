import { DateTime } from "luxon";
import type { Span } from "./intervals.js";
import type { IsoSlot, UtcInstant, ZoneId } from "./types.js";

export function formatUtc(ms: number): UtcInstant {
  return DateTime.fromMillis(ms, { zone: "utc" }).toFormat("yyyy-MM-dd'T'HH:mm:ss'Z'");
}

function formatLocal(ms: number, zone: ZoneId): string {
  const upper = zone.toUpperCase();
  if (upper === "UTC" || upper === "GMT") return formatUtc(ms);
  return DateTime.fromMillis(ms, { zone }).toFormat("yyyy-MM-dd'T'HH:mm:ssZZ");
}

/** SPEC §4.9: offset form in `zone`, `Z` for UTC/GMT. */
export function toIsoSlot(span: Span, zone: ZoneId): IsoSlot {
  return {
    start: formatLocal(span.startMs, zone),
    end: formatLocal(span.endMs, zone),
    startUtc: formatUtc(span.startMs),
    endUtc: formatUtc(span.endMs),
  };
}

/** Offset minutes -> "+05:45" / "-05:00" / "+00:00". */
export function formatOffset(minutes: number): string {
  const abs = Math.abs(minutes);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  return `${minutes < 0 ? "-" : "+"}${hh}:${mm}`;
}
