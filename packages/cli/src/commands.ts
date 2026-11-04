import { evaluate, explain, suggest } from "@marvinliem/tempo-core";
import type { ExplainResult, NegotiationRequest, NegotiationResult } from "@marvinliem/tempo-core";
import type { Command } from "./args.js";

/** Each command is one core call (A-78). */
export const commands: Record<Command, (input: NegotiationRequest) => NegotiationResult | ExplainResult> = {
  check: (input) => evaluate(input),
  suggest: (input) => suggest(input),
  explain: (input) => explain(input),
};
