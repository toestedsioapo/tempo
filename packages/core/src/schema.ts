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
  .regex(/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d:[0-5]\dZ$/)
  .refine((s) => DateTime.fromISO(s, { zone: "utc" }).isValid, {
    message: "Not a valid UTC instant",
  });

export const DayNameSchema = z.enum(DAY_NAMES);

/** IANA zone id; real-zone validation happens in the engine (A-37). */
export const ZoneIdSchema = z.string().min(1);

/** One wall-clock window. `end < start` wraps midnight; `start == end` is allowed in rules (A-37). */
export const IntervalSchema = z.strictObject({
  start: ClockTimeSchema,
  end: EndTimeSchema,
});

export const MeetingRequestSchema = z
  .strictObject({
    date: LocalDateSchema,
    start: ClockTimeSchema,
    end: ClockTimeSchema,
    timeZone: ZoneIdSchema,
  })
  .refine((r) => r.start !== r.end, {
    message: "Request start and end must differ.",
    path: ["end"],
  });

/** Weekly rules: one optional key per day name, built from DAY_NAMES. */
const WeeklyRulesSchema = z.strictObject(
  Object.fromEntries(DAY_NAMES.map((d) => [d, z.array(IntervalSchema).optional()])) as Record<
    (typeof DAY_NAMES)[number],
    z.ZodOptional<z.ZodArray<typeof IntervalSchema>>
  >,
);

export const PartyRulesSchema = z.strictObject({
  partyId: z.string().min(1).max(64),
  timeZone: ZoneIdSchema,
  weeklyRules: WeeklyRulesSchema,
  blackouts: z.array(LocalDateSchema).default([]),
});

export const OptionsSchema = z.strictObject({
  now: UtcInstantSchema,
  minNoticeMinutes: z.number().int().min(0).max(525600).default(0),
  searchHorizonDays: z.number().int().min(1).max(90).default(14),
  searchStepMinutes: z.number().int().min(1).max(1440).default(15),
  maxSuggestions: z.number().int().min(1).max(10).default(3),
});

export const NegotiationRequestSchema = z.strictObject({
  request: MeetingRequestSchema,
  participants: z
    .array(PartyRulesSchema)
    .min(2)
    .max(50)
    .superRefine((parties, ctx) => {
      const seen = new Set<string>();
      parties.forEach((p, i) => {
        if (seen.has(p.partyId)) {
          ctx.addIssue({
            code: "custom",
            message: `Duplicate partyId "${p.partyId}"`,
            path: [i, "partyId"],
          });
        }
        seen.add(p.partyId);
      });
    }),
  options: OptionsSchema,
});
