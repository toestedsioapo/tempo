import { negotiate } from "./evaluate.js";
import { guardedRun } from "./guard.js";
import type { NegotiationRequest, NegotiationResult } from "./types.js";

/**
 * SPEC §3.3 / §4.7. Same shape and reasons as `evaluate`; `slots` always holds the ranked,
 * non-overlapping search result, so on a `book` the requested slot comes first (A-66).
 * Never throws (D13, G33).
 */
export function suggest(input: NegotiationRequest): NegotiationResult {
  return guardedRun(input, (request) => negotiate(request, "suggest"));
}
