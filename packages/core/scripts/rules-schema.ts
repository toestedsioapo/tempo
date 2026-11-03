import { z } from "zod";
import { NegotiationRequestSchema } from "../src/schema.js";

/** Dev-only (A-22): not exported from src/index.ts. */
export function buildRulesJsonSchema(): Record<string, unknown> {
  const schema = z.toJSONSchema(NegotiationRequestSchema, {
    target: "draft-2020-12",
    io: "input",
  }) as Record<string, unknown>;
  return { ...schema, title: "Tempo negotiation request" };
}

export function renderRulesJsonSchema(): string {
  return JSON.stringify(buildRulesJsonSchema(), null, 2) + "\n";
}
