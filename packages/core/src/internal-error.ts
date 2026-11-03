import type { ErrorResult } from "./types.js";

/** A-63: the fixed INTERNAL_ERROR value; carries no details. */
export function internalError(): ErrorResult {
  return {
    ok: false,
    error: {
      code: "INTERNAL_ERROR",
      message: "Internal error: Tempo failed while evaluating an accepted request. This is a bug.",
    },
  };
}
