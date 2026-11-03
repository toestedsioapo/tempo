import { DateTime } from "luxon";
import { z } from "zod";

export const DAY_NAMES = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;

/** Calendar date `YYYY-MM-DD`, validated as a real date. */
export const LocalDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => DateTime.fromFormat(s, "yyyy-MM-dd", { zone: "utc" }).isValid, {
    message: "Not a valid calendar date",
  });

/** Wall-clock time `HH:mm`, 00:00 to 23:59. */
export const ClockTimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

/** Window end: a ClockTime or `24:00` (end of day). */
export const EndTimeSchema = z.union([ClockTimeSchema, z.literal("24:00")]);

/** UTC instant `YYYY-MM-DDTHH:mm:ssZ` (no fractional seconds, no offsets). */
export const UtcInstantSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/)
  .refine((s) => DateTime.fromISO(s, { zone: "utc" }).isValid, {
    message: "Not a valid UTC instant",
  });

export const DayNameSchema = z.enum(DAY_NAMES);

/** IANA zone id; real-zone validation happens in the engine (A-37). */
export const ZoneIdSchema = z.string().min(1);
