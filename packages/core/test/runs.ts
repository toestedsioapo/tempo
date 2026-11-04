/**
 * Number of fast-check runs per property (A-65): 200 on PR, 5,000 nightly via TEMPO_PROP_RUNS.
 * Test code may read `process.env`; core `src/` may not (CORE-40).
 */
export function propRuns(): number {
  const raw = process.env["TEMPO_PROP_RUNS"];
  const n = raw === undefined ? NaN : Number(raw);
  return Number.isInteger(n) && n > 0 ? n : 200;
}

/** Per-test timeout that scales with the run count (about 1 s per run, plus a minute of headroom). */
export function propTimeoutMs(): number {
  return 60_000 + propRuns() * 1000;
}
