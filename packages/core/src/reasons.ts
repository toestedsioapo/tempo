import type { LocalDate, Reason, UtcInstant } from "./types.js";

/** Exact SPEC §3.5 templates. */
export const inPast = (startUtc: UtcInstant, now: UtcInstant): Reason => ({
  code: "IN_PAST",
  message: `Requested start ${startUtc} is before now ${now}.`,
});

export const insufficientNotice = (startUtc: UtcInstant, minNoticeMinutes: number, bound: UtcInstant): Reason => ({
  code: "INSUFFICIENT_NOTICE",
  message: `Requested start ${startUtc} is earlier than now plus ${minNoticeMinutes} minutes (${bound}).`,
});

export const outsideAvailability = (partyId: string): Reason => ({
  code: "OUTSIDE_AVAILABILITY",
  participantId: partyId,
  message: `${partyId}: requested interval is not inside any availability interval.`,
});

export const inBlackout = (partyId: string, date: LocalDate): Reason => ({
  code: "IN_BLACKOUT",
  participantId: partyId,
  message: `${partyId}: availability is blocked by blackout date ${date}.`,
});
