import { formatIssuePath } from "./issues.js";
import { NegotiationRequestSchema } from "./schema.js";
import type { ErrorResult, ResolvedNegotiationRequest } from "./types.js";

/** Validate untyped input. Errors are values (D13): never throws. */
export function parseNegotiationRequest(
  input: unknown,
): { ok: true; value: ResolvedNegotiationRequest } | ErrorResult {
  let parsed: ReturnType<typeof NegotiationRequestSchema.safeParse>;
  try {
    parsed = NegotiationRequestSchema.safeParse(input);
  } catch {
    // Defensive (D13): Zod itself throws when reading hostile input (throwing getters,
    // Proxy traps). Report it as a value at the root rather than letting it escape.
    const message = "Input could not be read.";
    return {
      ok: false,
      error: { code: "INVALID_INPUT", message, details: { issues: [{ path: "$", message }] } },
    };
  }
  if (parsed.success) return { ok: true, value: parsed.data };
  const issues = parsed.error.issues.map((i) => ({
    path: formatIssuePath(i.path),
    message: i.message,
  }));
  return {
    ok: false,
    error: {
      code: "INVALID_INPUT",
      message: issues[0]?.message ?? "Invalid input.",
      details: { issues },
    },
  };
}
