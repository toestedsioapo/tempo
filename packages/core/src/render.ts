import { DateTime } from "luxon";
import type { Span } from "./intervals.js";
import type { IsoSlot, UtcInstant, ZoneId } from "./types.js";

export function formatUtc(ms: number): UtcInstant {
  return DateTime.fromMillis(ms, { zone: "utc" }).toFormat("yyyy-MM-dd'T'HH:mm:ss'Z'");
}

function formatLocal(ms: number, zone: ZoneId): string {
  if (zone === "UTC" || zone === "GMT") return formatUtc(ms);
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
