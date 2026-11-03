import type { z } from "zod";
import type {
  CandidateTraceSchema,
  ClockTimeSchema,
  DayNameSchema,
  EndTimeSchema,
  ErrorCodeSchema,
  ErrorResultSchema,
  ExplainResultSchema,
  IntervalSchema,
  IsoSlotSchema,
  LocalDateSchema,
  MeetingRequestSchema,
  NegotiationOkSchema,
  NegotiationRequestSchema,
  NegotiationResultSchema,
  OptionsSchema,
  ParticipantCheckSchema,
  PartyRulesSchema,
  ReasonCodeSchema,
  ReasonSchema,
  RuleRefSchema,
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

export type ReasonCode = z.infer<typeof ReasonCodeSchema>;
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;
export type IsoSlot = z.infer<typeof IsoSlotSchema>;
export type Reason = z.infer<typeof ReasonSchema>;
export type ErrorResult = z.infer<typeof ErrorResultSchema>;
export type NegotiationOk = z.infer<typeof NegotiationOkSchema>;
export type NegotiationResult = z.infer<typeof NegotiationResultSchema>;
export type ExplainResult = z.infer<typeof ExplainResultSchema>;
export type CandidateTrace = z.infer<typeof CandidateTraceSchema>;
export type ParticipantCheck = z.infer<typeof ParticipantCheckSchema>;
export type RuleRef = z.infer<typeof RuleRefSchema>;
