import { applyBlackouts, expandInstances, mergeSpans } from "./intervals.js";
import type { Span } from "./intervals.js";
import type { PartyRules } from "./types.js";

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

export type SearchArgs = {
  /** The requested interval; its real length (absolute ms) is the candidate length Δ. */
  readonly requested: Span;
  /** now + minNoticeMinutes: candidates must start at or after it (SPEC §4.5, §4.7). */
  readonly boundMs: number;
  readonly parties: readonly PartyRules[];
  readonly horizonDays: number;
  readonly stepMinutes: number;
  readonly maxSuggestions: number;
};

/** Intersection of two sorted, pairwise-separated span lists; empty (zero-length) pieces are dropped. */
function intersect(a: readonly Span[], b: readonly Span[]): Span[] {
  const out: Span[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const x = a[i] as Span;
    const y = b[j] as Span;
    const startMs = Math.max(x.startMs, y.startMs);
    const endMs = Math.min(x.endMs, y.endMs);
    if (startMs < endMs) out.push({ startMs, endMs });
    if (x.endMs < y.endMs) i++;
    else j++;
  }
  return out;
}

/** True iff `c` lies inside one span of `spans` (sorted, separated): binary search on start. */
function inside(spans: readonly Span[], c: Span): boolean {
  let lo = 0;
  let hi = spans.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if ((spans[mid] as Span).startMs <= c.startMs) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  const s = spans[found];
  return s !== undefined && c.endMs <= s.endMs;
}

/** A-27: two slots overlap iff each starts strictly before the other ends; touching slots do not. */
const overlaps = (a: Span, b: Span): boolean => a.startMs < b.endMs && b.startMs < a.endMs;

/**
 * SPEC §4.7 (C9, A-06, G22). Lattice s_k = rs + k·step (absolute minutes) with |s_k − rs| <= H·24 h and
 * s_k >= bound; a candidate [s_k, s_k + Δ] fits iff every party has it inside one merged open span.
 * Ranked by |s_k − rs|, ties earlier first; picked greedily, skipping any candidate that overlaps a
 * pick. Cost is O(H·24h/step · log n) after expansion: no per-minute arrays.
 */
export function searchSlots(args: SearchArgs): Span[] {
  const { requested, boundMs, parties, horizonDays, stepMinutes, maxSuggestions } = args;
  const rs = requested.startMs;
  const duration = requested.endMs - requested.startMs;
  const horizonMs = horizonDays * DAY_MS;
  const fromMs = rs - horizonMs;
  const toMs = rs + horizonMs + duration;

  let common: Span[] = [{ startMs: fromMs, endMs: toMs }];
  for (const party of parties) {
    const open = mergeSpans(applyBlackouts(expandInstances(party, fromMs, toMs), party.blackouts));
    common = intersect(common, open);
  }

  const picked: Span[] = [];
  const consider = (startMs: number): void => {
    if (picked.length >= maxSuggestions || startMs < boundMs) return;
    const c = { startMs, endMs: startMs + duration };
    if (inside(common, c) && !picked.some((p) => overlaps(p, c))) picked.push(c);
  };

  const stepMs = stepMinutes * MINUTE_MS;
  consider(rs);
  for (let d = stepMs; d <= horizonMs && picked.length < maxSuggestions && common.length > 0; d += stepMs) {
    consider(rs - d);
    consider(rs + d);
  }
  return picked;
}
