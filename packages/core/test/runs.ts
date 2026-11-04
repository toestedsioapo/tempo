/**
 * Number of fast-check runs per property (A-65): 200 on PR, 5,000 nightly via TEMPO_PROP_RUNS.
 * Test code may read `process.env`; core `src/` may not (CORE-40).
 */
export function propRuns(): number {
  const raw = process.env["TEMPO_PROP_RUNS"];
  if (raw === undefined || raw === "") return 200;
  const n = Number(raw);
  // A set-but-invalid value (a typo in nightly.yml) must not silently drop back to 200 runs.
  if (!Number.isInteger(n) || n <= 0) throw new Error(`TEMPO_PROP_RUNS must be a positive integer, got "${raw}"`);
  return n;
}

/** Per-test timeout that scales with the run count (about 1 s per run, plus a minute of headroom). */
export function propTimeoutMs(): number {
  return 60_000 + propRuns() * 1000;
}
