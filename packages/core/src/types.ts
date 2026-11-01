/**
 * @tempo/core - Public types matching SPEC.md
 */

export type PartyRules = {
  partyId: string;
  zone: string; // IANA, e.g. "America/New_York", "UTC", "Australia/Sydney"
  availability: Interval[];
  minimumNoticeMinutes: number;
};

export type Interval = {
  start: string; // ISO-8601 local time, e.g. "09:00"
  end: string; // ISO-8601 local time, e.g. "17:00"
};

export type NegotiationRequest = {
  date: string; // e.g. "2026-07-13"
  start: string; // ISO-8601 local time, e.g. "22:00"
  end: string; // ISO-8601 local time, e.g. "23:00"
  requesterTimeZone: string; // IANA zone
  partyA: PartyRules;
  partyB: PartyRules;
  now: string; // ISO-8601 UTC, e.g. "2026-07-13T00:00:00Z"
};

export type NegotiationResult = {
  ok: true;
  slots: IsoSlot[];
};

export type ErrorResult = {
  ok: false;
  error: ErrorCode;
};

export type IsoSlot = {
  start: string; // ISO-8601 with offset, e.g. "2026-07-14T15:00:00-04:00"
  end: string; // ISO-8601 with offset, e.g. "2026-07-14T16:00:00-04:00"
};

export type ErrorCode =
  | "invalid_interval"
  | "no_overlap"
  | "blackout"
  | "counter_offer";
export type DayName =
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday"
  | "sunday";