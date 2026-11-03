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

// ---------------------------------------------------------------------------
// Output (SPEC §3.3 - §3.6). Output objects are strict so drift fails loudly.
// ---------------------------------------------------------------------------

/** Reasons that may appear in `reasons`. `OK` is check-only and deliberately absent. */
export const ReasonCodeSchema = z.enum([
  "IN_PAST",
  "INSUFFICIENT_NOTICE",
  "OUTSIDE_AVAILABILITY",
  "IN_BLACKOUT",
  "NO_SLOTS_IN_HORIZON",
  "DST_RULE_ADJUSTED",
]);

/** Per-participant check outcome in `explain`. */
export const CheckReasonCodeSchema = z.enum(["OK", "OUTSIDE_AVAILABILITY", "IN_BLACKOUT"]);

export const ErrorCodeSchema = z.enum([
  "INVALID_INPUT",
  "INVALID_ZONE",
  "AMBIGUOUS_ZONE",
  "INVALID_INTERVAL",
  "DST_NONEXISTENT_LOCAL_TIME",
  "DST_AMBIGUOUS_LOCAL_TIME",
  "INTERNAL_ERROR",
]);

/** ISO-8601 local date-time with a numeric offset or `Z`, e.g. `2025-01-06T09:30:00-05:00`. */
export const IsoOffsetSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(Z|[+-]([01]\d|2[0-3]):[0-5]\d)$/);

export const IsoSlotSchema = z.strictObject({
  start: IsoOffsetSchema,
  end: IsoOffsetSchema,
  startUtc: UtcInstantSchema,
  endUtc: UtcInstantSchema,
});

export const ReasonSchema = z.strictObject({
  code: ReasonCodeSchema,
  participantId: z.string().optional(),
  message: z.string(),
});

export const ErrorResultSchema = z.strictObject({
  ok: z.literal(false),
  error: z.strictObject({
    code: ErrorCodeSchema,
    message: z.string(),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
});

export const NegotiationOkSchema = z.strictObject({
  ok: z.literal(true),
  decision: z.enum(["book", "counter_offer"]),
  requested: IsoSlotSchema,
  slots: z.array(IsoSlotSchema),
  reasons: z.array(ReasonSchema),
});

export const NegotiationResultSchema = z.union([NegotiationOkSchema, ErrorResultSchema]);

export const RuleRefSchema = z.strictObject({
  weekday: DayNameSchema,
  start: ClockTimeSchema,
  end: EndTimeSchema,
  ownerDate: LocalDateSchema,
});

export const ParticipantCheckSchema = z.strictObject({
  participant: z.string(),
  ruleMatched: RuleRefSchema.nullable(),
  pass: z.boolean(),
  reasonCode: CheckReasonCodeSchema,
});

export const CandidateTraceSchema = z.strictObject({
  slot: IsoSlotSchema,
  pass: z.boolean(),
  timeGate: z.enum(["OK", "IN_PAST", "INSUFFICIENT_NOTICE"]),
  checks: z.array(ParticipantCheckSchema),
});

const ExplainOkSchema = z.strictObject({
  ok: z.literal(true),
  decision: z.enum(["book", "counter_offer"]),
  reasons: z.array(ReasonSchema),
  requested: CandidateTraceSchema,
  candidates: z.array(CandidateTraceSchema),
});

export const ExplainResultSchema = z.union([ExplainOkSchema, ErrorResultSchema]);
