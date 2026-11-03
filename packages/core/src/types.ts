import type { z } from "zod";
import type {
  ClockTimeSchema,
  DayNameSchema,
  EndTimeSchema,
  IntervalSchema,
  LocalDateSchema,
  MeetingRequestSchema,
  NegotiationRequestSchema,
  OptionsSchema,
  PartyRulesSchema,
  UtcInstantSchema,
  ZoneIdSchema,
} from "./schema.js";

export type NegotiationRequest = z.infer<typeof NegotiationRequestSchema>;
export type NegotiationRequestInput = z.input<typeof NegotiationRequestSchema>;
export type MeetingRequest = z.infer<typeof MeetingRequestSchema>;
export type PartyRules = z.infer<typeof PartyRulesSchema>;
export type Interval = z.infer<typeof IntervalSchema>;
export type Options = z.infer<typeof OptionsSchema>;
export type DayName = z.infer<typeof DayNameSchema>;
export type ZoneId = z.infer<typeof ZoneIdSchema>;
export type LocalDate = z.infer<typeof LocalDateSchema>;
export type ClockTime = z.infer<typeof ClockTimeSchema>;
export type EndTime = z.infer<typeof EndTimeSchema>;
export type UtcInstant = z.infer<typeof UtcInstantSchema>;
