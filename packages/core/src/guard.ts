import { internalError } from "./internal-error.js";
import { parseNegotiationRequest } from "./parse.js";
import type { ErrorResult, ResolvedNegotiationRequest } from "./types.js";

/**
 * G33: an exception while parsing or validating input is INVALID_INPUT (A-59); any exception
 * after the input was accepted is INTERNAL_ERROR (A-63). Both are returned as values (D13).
 */
export function guardedRun<T extends { ok: boolean }>(
  input: unknown,
  run: (request: ResolvedNegotiationRequest) => T,
): T | ErrorResult {
  let parsed: ReturnType<typeof parseNegotiationRequest>;
  try {
    parsed = parseNegotiationRequest(input);
  } catch {
    const message = "Input could not be read.";
    return {
      ok: false,
      error: { code: "INVALID_INPUT", message, details: { issues: [{ path: "$", message }] } },
    };
  }
  if (!parsed.ok) return parsed;
  try {
    return run(parsed.value);
  } catch {
    return internalError();
  }
}
