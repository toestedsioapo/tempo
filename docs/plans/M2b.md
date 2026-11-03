# Milestone 2b — DST, slot search, `suggest`, `explain`: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** the complete core: DST request-time rejection (C10), rule-boundary policy (A-07), counter-offer search with `suggest()`, `explain()`, all 24 worked examples byte-exact, INV-01 … INV-14 and the full differential oracle.

**Architecture:** `dst.ts` owns wall-time classification (0/1/2 instants plus offsets); `wallTimeToMs` moves there and is built on the classifier. `guard.ts` is the single never-throws wrapper shared by `evaluate`, `suggest` and `explain` (parse failure → `INVALID_INPUT`, later failure → `INTERNAL_ERROR`). `availability.ts` holds the per-participant check that `evaluate` reasons and `explain` traces both read. `search.ts` is the lattice search with greedy selection. The oracle stays in `test/oracle/` and shares no code with `src/`.

**Tech Stack:** unchanged (TypeScript, Luxon, Zod, Vitest, fast-check). No new runtime dependency.

**Spec:** `ROADMAP.md` §M2b and its "Notes carried from M2a review"; `SPEC.md` §3.3–§3.6, §4.1–§4.9, EX-01 … EX-24; `TEST_PLAN.md` CORE-24 … CORE-39, CORE-43, INV-01 … INV-14, G-01 … G-05, ORC-01, ORC-02; `DECISIONS.md` C9, C10, D13, D15, G22, G28, G31, G32; `ASSUMPTIONS.md` A-05, A-06, A-07, A-11, A-18, A-26, A-27, A-52 … A-60.

## Global Constraints

- M1/M2a constraints still bind: `strict` + `noUncheckedIndexedAccess`; ESM `NodeNext` with `.js` imports; core runtime dependencies exactly `luxon` and `zod`; core is pure (no `Date`, `Date.now`, `DateTime.now`, `process`, `fs`, randomness, network); Luxon with explicit zones, never raw `Date` math.
- Core never throws (D13). After this milestone it can return `INTERNAL_ERROR` as a value (Task 2).
- Validation order is SPEC §4.1: schema → zones → intervals → request wall times (Task 1) → everything else. First failure wins.
- Intervals are closed; instances owned by their start day; blackouts remove owned instances only (C5, C6, A-16).
- **Rule-boundary DST policy (G34, amends A-07's gap half):** a nonexistent boundary, start **or** end, resolves to the transition instant (the first instant after the gap, `transitionMs`); an ambiguous boundary resolves to the earlier occurrence (A-07 overlap half, unchanged). After resolving, an instance with `endMs <= startMs` (rule wholly inside the gap) is dropped with no reason.
- Lattice: `s_k = rs + k × step`, `|s_k − rs| ≤ H × 24 h`, `s_k >= now + minNotice`; rank `(|s_k − rs|, s_k)`; greedy skip-on-overlap, touching slots both kept (G22, A-27); candidate length is the **real** request duration Δ in absolute ms.
- Reason order: `IN_PAST|INSUFFICIENT_NOTICE`; per participant by `partyId` code-unit order: failure reason, then its `DST_RULE_ADJUSTED` notes chronologically; `NO_SLOTS_IN_HORIZON` last (SPEC §3.5).
- Exit codes and JSON shapes are public API; `public-api.test.ts` pins the export list (G31). `suggest` and `explain` join it in Task 4/5.
- Coverage ≥ 95 % lines and branches, gate widened to **all** of core in Task 7 (A-58).
- Run counts: 200 per property on PR, 5,000 nightly (TEST_PLAN G-section). Failing seeds are pinned as regression tests.

## Review Focus

Inputs the spec implies that are most likely to bite; each has a test in the owning task.

1. **Request span inside a gap** (NY 2025-03-09 `02:30`–`03:15`): must be `DST_NONEXISTENT_LOCAL_TIME`, never a `book` whose end precedes its start (Task 1).
2. **Request `end` in a gap or overlap**, including `end` on the next date after midnight wrap (`23:30`→`02:30` on a transition night): `details.field` is `request.end` and `localTime` carries the **end's** date (Task 1).
3. **Rule touching a gap** (NY 2025-03-09): `02:30–03:15` keeps its 15 real minutes `[07:00Z, 07:15Z]`; `02:30–03:00` and `02:00–03:00` (wholly inside the gap) are dropped; an overnight rule ending `02:30` ends at `07:00Z`. Never an inverted or zero-length instance, never fake availability (G34) (Task 3).
4. **Slot landing in a fall-back overlap hour** is returned as explicit instants and offsets; re-submitting it with `timeZone: "UTC"` books (INV-03, A-26) (Task 4/6).
5. **Search edge arithmetic**: horizon boundary inclusive, `searchStepMinutes` that does not divide 24 h, `maxSuggestions` larger than the number of fitting slots, `minNotice` pushing the lattice start (Task 4).

## Decision D-1 (resolved: G34)

A DST gap must not give a rule fake availability or lose real minutes. Clocks go `01:59 → 03:00` on 2025-03-09 in `America/New_York`, so a nonexistent boundary resolves to the **transition instant** `07:00Z`, whichever end of the rule it is. A shift ending `02:30` really ends at `07:00Z`; a shift starting `02:30` really starts at `07:00Z`; rule `02:30–03:15` really has `03:00–03:15 EDT` (15 min). A rule wholly inside the gap resolves to `endMs <= startMs` and is dropped, with no reason. This amends the gap half of A-07 (which resolved forward with the pre-transition offset, `02:30 → 03:30 EDT`) and is recorded as DECISIONS **G34** in Task 1 Step 1. The overlap half of A-07 is unchanged.

## Execution conventions

One branch per task (`git switch main && git switch -c m2b/tNN-<slug>`), merged into local `main` with `--no-ff` after review; task close-out runs `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build` at the root. Nothing is pushed until the closing gate (Task 7). Conventional Commits with the standard attribution trailer. Anything undecided becomes an `A-nn` row (next free number is A-61), recorded in Task 7.

**Task order note:** your message listed the A-59 decision first but said DST rejection must be the FIRST task. This plan makes DST Task 1 and A-59/G33 Task 2; the two do not depend on each other, so swap them if you prefer.

## Assumptions made by this plan (recorded in Task 7 as `A-61 … A-66`)

| ID | Assumption | Why |
|---|---|---|
| A-61 | `DST_RULE_ADJUSTED` is emitted for each **non-blacked-out** instance of a participant that has a gap/overlap boundary **and** strictly overlaps the requested span (`i.startMs < span.endMs && i.endMs > span.startMs`). One note per adjusted boundary; a boundary is identified by `(instance, start|end)`. Emitted on `book` and `counter_offer` alike, after the participant's failure reason, in chronological order of the boundary's resolved instant. `suggest`/`explain` report the same reasons as `evaluate` (they describe the requested slot only) | SPEC §3.5 and EX-24 fix the template and the "overlaps the request" trigger but not blackout interplay or count |
| A-62 | The classifier assumes at most one UTC-offset change within ±24 h of a wall reading (true for every IANA zone in the fixture set and, to our knowledge, in current tzdata). It reads offsets at `W−24h` and `W+24h` as A-53 does | A-53's algorithm already relies on it; stated explicitly now that it drives error details |
| A-63 | `INTERNAL_ERROR` message is `Internal error: Tempo failed while evaluating an accepted request. This is a bug.`, with no `details` and never the exception text or stack (determinism, no leakage) | SPEC §3.4 lists `details: —` for this code |
| A-64 | The oracle is genuinely independent of the engine's boundary policy: an instance is the set of UTC minutes whose wall reading in the party's zone (owner-date logic as in M2a) lies in `[rule.start, rule.end)`. With G34 this agrees with the engine at gaps, wholly-inside-gap rules vanish by themselves, and no boundary table is re-implemented. The one documented exception is fall-back overlaps: inside a repeated hour pure wall-membership would leave a hole (rule `01:30–05:00` on 2025-11-02 NY would skip `[06:00Z, 06:30Z)`), so the oracle keeps A-07's earlier-occurrence policy there, implemented as "the instance runs from the first minute whose wall reading is `>= start` to the first minute whose wall reading is `>= end`", which equals wall-membership everywhere except across a repeated hour. The exception is stated in the `oracle.ts` header. ORC-02 no longer excludes EX-24 and ORC-01 generators oversample transitions (G-01, G-02) | A-55 excluded DST only because the oracle lacked this; TEST_PLAN says generators oversample transitions |
| A-65 | The nightly 5,000-run job is a separate workflow `.github/workflows/nightly.yml` (cron + `workflow_dispatch`), setting `TEMPO_PROP_RUNS=5000`; property files read `Number(process.env.TEMPO_PROP_RUNS ?? 200)` through one test helper (test code may read `process.env`; core `src/` may not) | `process.env` is forbidden only in `src/` (CORE-40) |
| A-66 | `suggest` on a `book` returns `slots` = the requested slot first, then further ranked non-overlapping alternatives up to `maxSuggestions` (SPEC §3.3); `evaluate` on a `book` keeps `slots: [requested]` | SPEC §3.3 wording |

---

### Task 1: `dst.ts` classifier and C10 request-time rejection (CORE-35 … CORE-37, CORE-39, EX-12, EX-13)

**Files:**
- Create: `packages/core/src/dst.ts`, `packages/core/src/dst.test.ts`, `packages/core/src/internal-error.ts`, `packages/core/src/evaluate.invariant.test.ts`
- Modify: `packages/core/src/intervals.ts` (delete `wallTimeToMs`, import it), `packages/core/src/gates.ts`, `packages/core/src/render.ts` (+`formatOffset`), `packages/core/src/evaluate.ts`, `packages/core/src/evaluate.test.ts:375-377`, `packages/core/src/intervals.test.ts` (import path), `packages/core/test/examples.test.ts`, `packages/core/test/helpers.ts` (fixture zone/date table); G34 documents: `DECISIONS.md`, `SPEC.md` §4.3 and EX-24, `ASSUMPTIONS.md` (A-07, A-53), `ARCHITECTURE.md` ADR 4, `PLAN.md`, `TEST_PLAN.md` CORE-38, `packages/core/fixtures/examples/ex-24.json` (re-extracted)

**Interfaces:**
- Consumes: `LocalDate`, `ClockTime | EndTime`, `ZoneId`, `ResolvedNegotiationRequest`, `ErrorResult` from `types.ts`; `formatUtc` from `render.ts`.
- Produces in `dst.ts`:
  - `type WallInstant = { readonly ms: number; readonly offsetMinutes: number }`
  - `type WallClassification = { readonly instants: readonly WallInstant[]; readonly offsetBeforeMinutes: number; readonly offsetAfterMinutes: number; readonly transitionMs: number | null }` — `instants` is ascending by `ms`, length 0 (gap), 1 (normal) or 2 (overlap); `offsetBefore/After` are the zone offsets at `W−24h` / `W+24h`; `transitionMs` is the first instant the new offset applies, non-null iff `instants.length !== 1`, found by bisecting the offset change between the two probe points to the minute.
  - `classifyWallTime(date: LocalDate, time: ClockTime | EndTime, zone: ZoneId): WallClassification` (`"24:00"` = next date `00:00`)
  - `wallTimeToMs(date, time, zone): number` — `instants[0].ms` if any (overlap → earlier, unchanged), else `transitionMs` (G34: a nonexistent time resolves to the first instant after the gap; this replaces M2a's pre-transition-offset forward resolution).
  - `internalError(): ErrorResult` in `internal-error.ts` — `{ ok: false, error: { code: "INTERNAL_ERROR", message: <A-63 text> } }`, no `details`; Task 2's guard reuses it.
  - `findDstError(request: ResolvedNegotiationRequest): ErrorResult | null` — checks `request.start` then `request.end` (end's date is `date`, or `date+1` when `end <= start`, SPEC §4.4).
- In `gates.ts`: `requestWallTimes(request): { start: { date: LocalDate; time: ClockTime }; end: { date: LocalDate; time: ClockTime } }`, used by both `requestedSpan` and `findDstError` (one definition of "which date is `end` on").
- In `render.ts`: `formatOffset(minutes: number): string` → `"-05:00"`, `"+05:45"`, `"+00:00"`.

- [ ] **Step 1: Record G34 first (documents only, then re-extract).** `DECISIONS.md` row G34: *A nonexistent availability-rule boundary, start or end, resolves to the transition instant (`transitionMs`, the first instant after the gap); an instance with `endMs <= startMs` after resolution (rule wholly inside the gap) is dropped with no reason. Amends the gap half of A-07 (G28); the overlap half (earlier occurrence) is unchanged* | *Resolving with the pre-transition offset (02:30 → 03:30 EDT) adds up to a gap's length of fake availability to a shift ending in the gap and removes real minutes from one starting in it; the transition instant is the real boundary*. Amend `ASSUMPTIONS.md` A-07 (gap half → transition instant, cite G34) and A-53 (mark its gap sentence superseded by G34). Amend `SPEC.md` §4.3 rule-boundary bullet, §3.5 `DST_RULE_ADJUSTED` row if it says "forward", and EX-24: expansion `bob` `[2025-03-09T07:00:00Z, 2025-03-09T14:00:00Z]` (`02:30` nonexistent → resolved `2025-03-09T07:00:00Z`), merged availability, evaluation prose, the policy line, and the output message `bob: rule boundary 2025-03-09T02:30 in America/New_York is nonexistent; resolved to 2025-03-09T07:00:00Z.`; still `book`. Amend `ARCHITECTURE.md` ADR 4, `PLAN.md` line 71 and `TEST_PLAN.md` CORE-38 ("gap boundary ⇒ transition instant; overlap boundary ⇒ earlier occurrence; wholly-inside-gap rule dropped"). Re-run the committed extractor to regenerate `ex-24.json`; `fixtures-drift.test.ts` passes. The EX-24 decision-tier assertion still passes (book).
- [ ] **Step 2: Write failing tests in `dst.test.ts`.** Table `classifyWallTime` rows (`[zone, date, time, instants.length]`): CORE-35 gaps → 0: `America/New_York 2025-03-09 02:00`, `02:30`, `02:59`; `Europe/Berlin 2025-03-30 02:30`; `Australia/Sydney 2025-10-05 02:30`; `Australia/Lord_Howe 2025-10-05 02:15`. CORE-36 overlaps → 2: `America/New_York 2025-11-02 01:00`, `01:59`; `Europe/Berlin 2025-10-26 02:30`; `Australia/Sydney 2025-04-06 02:30`; `Australia/Lord_Howe 2025-04-06 01:45`. CORE-37 → 1: `New_York 2025-03-09 01:59`, `03:00`; `2025-11-02 00:59`, `02:00`; `Lord_Howe 2025-10-05 02:30`. `Asia/Manila` every probed date/time → 1. Exact-value rows: NY gap `02:30` → `transitionMs` = `2025-03-09T07:00:00Z`, `offsetBeforeMinutes -300`, `offsetAfterMinutes -240`; NY overlap `01:30` → instants `[{05:30Z, -240}, {06:30Z, -300}]`; Lord_Howe gap offsets `+630`→`+660`. `transitionMs` is the first instant at which the offset equals `offsetAfterMinutes` (assert the instant one minute earlier still has `offsetBeforeMinutes`). `wallTimeToMs` rows: move the `wallTimeToMs (A-53)` table from `intervals.test.ts` here; unique and overlap rows unchanged; the gap rows change per G34 (NY `2025-03-09 02:30` → `2025-03-09T07:00:00Z`, not `07:30Z`; Lord_Howe `2025-10-05 02:15` → its transition instant).
- [ ] **Step 3: Write failing tests for `findDstError` and `evaluate`.** (a) **Regression (Review Focus 1):** `evaluate` of NY `2025-03-09` `02:30`→`03:15` equals `{ ok: false, error: { code: "DST_NONEXISTENT_LOCAL_TIME", ... details.field: "request.start" } }`, and for `02:30`→`03:30` likewise (these are the two `it.todo`s at `evaluate.test.ts:375-377`; convert them). (b) EX-12 and EX-13 fixtures `toEqual` expected, byte-exact, including `message` and `details` key order (`field, localTime, timeZone, transitionUtc, offsetBefore, offsetAfter`). (c) CORE-39: start valid, `end` in a gap (`2025-03-09 01:00`→`02:30`) → `details.field "request.end"`, `localTime "2025-03-09T02:30"`; start `23:30` on `2025-03-08`→ `end 02:30` (next date, gap) → `localTime "2025-03-09T02:30"`; end in an overlap likewise → `DST_AMBIGUOUS_LOCAL_TIME`, candidates ascending by instant. (d) Order: `request.start` error wins over `request.end`; an `INVALID_INTERVAL` or zone error wins over a DST error (SPEC §4.1). (e) `formatOffset` rows: `-300→"-05:00"`, `345→"+05:45"`, `0→"+00:00"`, `630→"+10:30"`. (f) **Invariant:** in `evaluate.invariant.test.ts`, `vi.doMock("./gates.js")` so `requestedSpan` returns `{ startMs: 10, endMs: 5 }` (and `findDstError` passes); `evaluate` of a valid request returns exactly `internalError()`, not a `book`/`counter_offer` and not a throw.
- [ ] **Step 4: Run `pnpm --filter @marvinliem/tempo-core test`.** Expected: new tests FAIL (`dst.js` not found; todos converted).
- [ ] **Step 5: Implement `classifyWallTime`, `wallTimeToMs`, `findDstError`, `formatOffset`, `requestWallTimes`, `internalError` and wire `findDstError` into `compute()` after `findInvalidInterval`, before `requestedSpan`.** Messages (exact, SPEC EX-12/EX-13): `{localTime} does not exist in {zone} (clocks skip forward).` and `{localTime} occurs twice in {zone} (clocks fall back).`; `transitionUtc`/`candidates[].utc` via `formatUtc`; `offsetBefore/After`/`candidates[].offset` via `formatOffset`; `localTime` is `YYYY-MM-DDTHH:mm`. Move `wallTimeToMs` out of `intervals.ts` and update imports in `intervals.ts`, `gates.ts` and tests. **Do not delete** the `outsideAvailability` fallback branch at `evaluate.ts:22-25`: it is no longer reachable for valid input, so replace it with an explicit invariant check in `compute()` right after `requestedSpan`: `if (!(span.startMs < span.endMs)) return internalError();` (G33), and drop the fallback branch and its stale comment from `participantReason` (reaching it is then impossible by construction).
- [ ] **Step 6: Un-`todo` EX-12 and EX-13 in `examples.test.ts`** into the exact tier (move ids 12, 13 into `EXACT`; remove their `it.todo`s).
- [ ] **Step 7: Run `pnpm test`, `pnpm typecheck`, `pnpm lint`.** Expected: PASS; purity test still passes (`dst.ts` imports only `luxon` and local modules). Update CFG-08 in `tests/repo.test.ts` so `dst.ts exists in core` is a real assertion and the A-36 `it.todo` is removed.
- [ ] **Step 8: Commit** `feat(core): classify DST wall times, reject nonexistent/ambiguous request times (C10), resolve gap boundaries to the transition (G34)`.

### Task 2: Split the catch in `evaluate` (A-59 → G33)

**Files:**
- Create: `packages/core/src/guard.ts`
- Modify: `packages/core/src/evaluate.ts`, `packages/core/src/evaluate.catch.test.ts`, `SPEC.md` §3.4 (INTERNAL_ERROR row), `DECISIONS.md` (row G33), `ASSUMPTIONS.md` (A-59 → superseded by G33; add A-63), `ARCHITECTURE.md` ADR 6 (one sentence), `TEST_PLAN.md` (INV-10 note: both codes allowed)

**Interfaces:**
- Produces: `guardedRun<T extends { ok: boolean }>(input: unknown, run: (request: ResolvedNegotiationRequest) => T): T | ErrorResult` — try 1 wraps only `parseNegotiationRequest`: a throw returns `INVALID_INPUT` (message `Input could not be read.`, `details.issues [{ path: "$", message }]`, unchanged from A-59); a parse `ok: false` is returned as is. try 2 wraps only `run(parsed.value)`: any throw returns `internalError()` (Task 1; no `details`). `evaluate`, and later `suggest` and `explain`, are `guardedRun(input, compute…)`.

- [ ] **Step 1: Rewrite `evaluate.catch.test.ts`** with `vi.resetModules()` + `vi.doMock` per test and dynamic `import("./evaluate.js")`: (a) `parseNegotiationRequest` mocked to throw → exactly the existing `INVALID_INPUT` object; (b) parse real, `./dst.js` `findDstError` mocked to throw `new Error("secret")` (a stage that runs only after acceptance) → `toEqual({ ok:false, error:{ code:"INTERNAL_ERROR", message: "<A-63 text>" } })` and `JSON.stringify(result)` does not contain `"secret"`; (c) `exitCodeForError`-style check not here (CLI covers it, CLI-17).
- [ ] **Step 2: Run** `pnpm --filter @marvinliem/tempo-core test -- evaluate.catch` → (b) FAILS (currently `INVALID_INPUT`).
- [ ] **Step 3: Implement `guard.ts` and use it in `evaluate.ts`.**
- [ ] **Step 4: Docs.** SPEC §3.4 row becomes: `INTERNAL_ERROR | 4 (A-12) | a bug. Core returns it as a last resort when an exception occurs after the input was accepted (G33); the CLI also produces it for failures outside core | —`. Also fix the SPEC §3.4 sentence "core never throws" to stay true. DECISIONS `G33`: *An exception while parsing or validating input is `INVALID_INPUT`; any exception after the input is accepted is `INTERNAL_ERROR`, returned as a value (core still never throws). Supersedes A-59's single catch.* | Why: "bad input" and "engine bug" must be distinguishable for callers (Deskhand) and map to exit 2 vs 4.
- [ ] **Step 5: Run** `pnpm test` (the CLI exit-code tests already map `INTERNAL_ERROR` → 4) → PASS.
- [ ] **Step 6: Commit** `feat(core): return INTERNAL_ERROR for exceptions after input is accepted (G33)`.

### Task 3: Rule-boundary policy, `DST_RULE_ADJUSTED`, G34 (CORE-38, EX-24, EX-14 … EX-16)

**Files:**
- Modify: `packages/core/src/intervals.ts`, `packages/core/src/reasons.ts`, `packages/core/src/evaluate.ts`, `packages/core/src/intervals.test.ts`, `packages/core/src/reasons.test.ts`, `packages/core/src/evaluate.test.ts`, `packages/core/test/examples.test.ts`

**Interfaces:**
- Consumes: `classifyWallTime`, `WallClassification`, `formatOffset` (Task 1).
- Produces: `type BoundaryAdjustment = { readonly boundary: "start" | "end"; readonly localTime: string /* YYYY-MM-DDTHH:mm */; readonly kind: "nonexistent" | "ambiguous"; readonly resolvedMs: number }`; `Instance` gains `adjustments: readonly BoundaryAdjustment[]`; `resolveInstanceBoundaries(ownerDate, rule, zone): { startMs; endMs; adjustments } | null` (null = dropped: `endMs <= startMs` after G34 resolution); `expandInstances` uses it and omits nulls; `dstRuleAdjusted(partyId: string, a: BoundaryAdjustment, zone: ZoneId): Reason` with the exact template `{partyId}: rule boundary {localTime} in {zone} is {nonexistent|ambiguous}; resolved to {utc}.`; `adjustmentNotes(party: PartyRules, openInstances: readonly Instance[], span: Span): Reason[]` per A-61.

- [ ] **Step 1: Failing tests (`intervals.test.ts`).** CORE-38 rows (G34): NY 2025-03-09 rule `02:30–10:00` → `[07:00Z, 14:00Z]`, adjustments `[{start, "2025-03-09T02:30", nonexistent, 07:00Z}]`; rule `02:30–03:15` → `[07:00Z, 07:15Z]` (kept, one `start` adjustment); overnight `22:00–02:30` owned by 2025-03-08 → ends `07:00Z`, one `end` adjustment; rules `02:30–03:00` and `02:00–03:00` → no instance (dropped, no adjustments reported); Lord_Howe rule `02:00–02:30` on 2025-10-05 → dropped; overlap boundary earlier (NY 2025-11-02 rule `01:30–05:00` → start `05:30Z`, `ambiguous`, unchanged from A-07). Manila: no adjustments ever. **Carried M2a note:** blackout `2025-03-09` for a Manila party whose rule is `07:00–09:00` (`07:00` local = `23:00Z` the previous UTC day) removes exactly that owner date's instance, asserted directly on `applyBlackouts`.
- [ ] **Step 2: Failing tests (`evaluate.test.ts`, `reasons.test.ts`).** EX-24 moves to the exact tier (`reasons` equals the amended SPEC output, `resolved to 2025-03-09T07:00:00Z`). Notes follow A-61 literally (any strict overlap of an adjusted, non-blacked-out instance, not only overlap with the adjusted boundary): rule `02:30–10:00`, request `2025-03-09 12:00–13:00` NY → note emitted; request on `2025-03-10` → no note; request ending exactly at the instance start → no note (strict overlap); blacked-out adjusted instance → no note; `counter_offer` keeps note after the failure reason; two participants sorted by `partyId`.
- [ ] **Step 3: Run, expect FAIL.** **Step 4: Implement** `resolveInstanceBoundaries` (start from `classifyWallTime(ownerDate, rule.start)`, end date per SPEC §4.3 table, both via `instants[0]?.ms ?? transitionMs`; adjustments when `instants.length !== 1`, `resolvedMs` being the instant used; return `null` when `endMs <= startMs`), thread `adjustments` through, add `dstRuleAdjusted` and `adjustmentNotes`, and append notes in `compute()` after each participant's failure reason (`book` result carries them in `reasons`). **Step 5: Run** `pnpm test` → PASS.
- [ ] **Step 6: Commit** `feat(core): rule-boundary DST policy with DST_RULE_ADJUSTED (A-07, G34)`.

### Task 4: Counter-offer search and `suggest()` (CORE-25 … CORE-31, CORE-43, `NO_SLOTS_IN_HORIZON`)

**Files:**
- Create: `packages/core/src/availability.ts`, `packages/core/src/search.ts`, `packages/core/src/suggest.ts` and `*.test.ts` beside each
- Modify: `packages/core/src/evaluate.ts` (use `availability.ts`; `counter_offer` slots from `search.ts`), `packages/core/src/reasons.ts` (`noSlotsInHorizon`), `packages/core/src/index.ts`, `packages/core/src/public-api.test.ts`, `packages/core/test/examples.test.ts`

**Interfaces:**
- Produces in `availability.ts` (extracted from `evaluate.ts`'s `participantReason`): `type ParticipantAvailability = { pass: true; match: Instance } | { pass: false; reasonCode: "OUTSIDE_AVAILABILITY" | "IN_BLACKOUT"; blockedDate: LocalDate | null }`; `checkParticipant(party: PartyRules, span: Span): ParticipantAvailability` (`match` = the non-blacked-out instance with `start <= span.start <= end` that starts earliest, SPEC §3.6).
- Produces in `search.ts`: `searchSlots(args: { requested: Span; boundMs: number; parties: readonly PartyRules[]; horizonDays: number; stepMinutes: number; maxSuggestions: number }): Span[]` — builds each party's merged open spans over `[rs − H·24h, rs + H·24h + Δ]`, intersects them, then walks outward from `rs` in `step` increments emitting `rs − d` before `rs + d` (tie → earlier first), keeps a candidate iff `s >= boundMs` and `[s, s + Δ]` lies inside one intersected span (binary search), applies the greedy non-overlap rule, stops at `maxSuggestions`.
- Produces in `suggest.ts`: `suggest(input: NegotiationRequest): NegotiationResult` via `guardedRun`; exported from `index.ts` (G31).
- `noSlotsInHorizon(horizonDays: number): Reason` with the exact template `No slot found within {searchHorizonDays} days of the requested start.`

- [ ] **Step 1: Failing tests (`search.test.ts`).** CORE-25 (step 15 and 30: every slot start ≡ `rs` mod step); CORE-26 (a fitting slot exactly `H·24h` away included, one step beyond excluded); CORE-27 (default 3; 1 and 10 honoured; fewer when the horizon runs out); CORE-28 (equal distance → earlier first, including when the tied pair is not both picked); CORE-29 (duration equals request, incl. 23 h 59 min); CORE-43 (overlapping candidate skipped and never revisited; touching slots both kept); `minNotice` pushes the first lattice point (`boundMs` filter); a step of 7 minutes (does not divide 24 h) stays anchored at `rs`; slot straddling a DST transition keeps real duration Δ; fall-back overlap hour slot returned with correct offsets.
- [ ] **Step 2: Failing tests (`suggest.test.ts`, `evaluate.test.ts`).** CORE-30 (`suggest` of a bookable request → `slots[0]` is the requested slot, A-66); CORE-31 reason order incl. `NO_SLOTS_IN_HORIZON` last; `counter_offer` with empty search → `slots: []` plus the reason; `evaluate` on `book` keeps `slots: [requested]`; `public-api.test.ts` pins `suggest`.
- [ ] **Step 3: Failing example tests.** Move EX-02, 04, 06, 11, 17, 18, 19, 20, 21 from the decision tier to the exact tier; the `DECISION` tier and the `summary()` filter are deleted.
- [ ] **Step 4: Run, expect FAIL. Step 5: Implement** `availability.ts` (refactor, behaviour unchanged, all Task 1–3 tests stay green), `search.ts`, `suggest.ts`, wire `evaluate`. Never allocate per-minute arrays: complexity `O(H·24h/step · log n)`. **Step 6: Run** `pnpm test` and a manual timing of `searchHorizonDays 90, searchStepMinutes 1, maxSuggestions 10` on a two-party request (record the figure in the PR; target well under 1 s). Expected: PASS.
- [ ] **Step 7: Commit** `feat(core): ranked counter-offer search, suggest() and NO_SLOTS_IN_HORIZON (C9, G22)`.

### Task 5: `explain()` (CORE-33, CORE-34, EX-22)

**Files:**
- Create: `packages/core/src/explain.ts`, `packages/core/src/explain.test.ts`
- Modify: `packages/core/src/index.ts`, `packages/core/src/public-api.test.ts`, `packages/core/test/examples.test.ts`

**Interfaces:**
- Consumes: `checkParticipant`, `searchSlots`, `requestedSpan`, `timeGate`, `toIsoSlot`, reasons (Tasks 1–4).
- Produces: `explain(input: NegotiationRequest): ExplainResult` per SPEC §3.6 and A-18: `requested` and `candidates` are `CandidateTrace`; `candidates` equals exactly the slots `evaluate` returns on a `counter_offer` in rank order and is `[]` on `book`; `checks` sorted by `participant` code-unit order; `ruleMatched` is `{ weekday, start, end, ownerDate }` of `match.rule` for a pass and `null` for a fail; `reasonCode` is `"OK" | "OUTSIDE_AVAILABILITY" | "IN_BLACKOUT"`; `pass` is `timeGate === "OK" && every check passes`; `reasons` and `decision` are identical to `evaluate`'s.

- [ ] **Step 1: Failing tests.** CORE-33 (overnight match has `ruleMatched.ownerDate` = start day; `null` on failure; `checks` sorted; `candidates` `[]` on book); CORE-34 (for 50 fixed inputs `explain` agrees with `evaluate` on `decision`, `reasons`, and `candidates` ↔ `slots`); EX-22 byte-exact against its fixture (entry `explain`); error inputs return the same `ErrorResult` as `evaluate` (EX-12 through `explain`); `public-api.test.ts` pins `explain`.
- [ ] **Step 2: Run, expect FAIL. Step 3: Implement** `explain.ts` via `guardedRun`, sharing `compute`'s decision pipeline (extract a `decide(request)` returning `{ span, reasons, slots, … }` in `evaluate.ts` used by all three entry points; do not duplicate logic). **Step 4: Run** `pnpm test` → PASS; `examples.test.ts` runs the `explain` entry fixtures through `explain`.
- [ ] **Step 5: Commit** `feat(core): explain() with per-candidate traces (D15)`.

### Task 6: Full oracle and property invariants (ORC-01, ORC-02, INV-01 … INV-14, G-01 … G-05)

**Files:**
- Modify: `packages/core/test/oracle/oracle.ts`, `oracle.test.ts`, `differential.prop.test.ts`, `packages/core/test/helpers.ts`
- Create: `packages/core/test/invariants.prop.test.ts` (INV-01 … INV-14, grouped), `packages/core/test/generators.ts` (G-01 … G-05), `packages/core/test/runs.ts` (`propRuns(): number`)
- Create: `.github/workflows/nightly.yml`

**Interfaces:**
- Produces: `oracleSlots(input): { decision; failing: string[]; slots: Span[] }` — minute-by-minute availability by wall-reading membership per A-64 (no boundary table; the fall-back-overlap earlier-occurrence exception is the single documented deviation, stated in the `oracle.ts` header), its own lattice scan and its own greedy implementation; `propRuns(): number` (`Number(process.env.TEMPO_PROP_RUNS ?? 200)`); generators `zoneArb`, `dateNearTransitionArb` (≥ 50 % within ±2 days of a transition found by a Luxon scan helper, G-01), `wallTimeArb` (≥ 50 % in `00:00–04:00`, G-02), `rulesArb` (overnight, `24:00`, touching, overlapping, split shifts, G-03), `blackoutsArb` (owner dates, day after, UTC≠local, G-04), `durationArb` (15 min–23 h 59 min, G-05); zones: New_York, Berlin, Sydney, Lord_Howe, Manila, Kolkata, Kathmandu, UTC.

- [ ] **Step 1: Extend the oracle and its tests first.** ORC-02: all 24 examples now pass the oracle including EX-24 and including slots where the example has them (EX-12/13 are error examples, skipped by `ok: false`). Add oracle unit rows for the G34 cases (NY `02:30–10:00` → `[07:00Z, 14:00Z]`; `02:30–03:15` → `[07:00Z, 07:15Z]`; `02:30–03:00` empty; overnight `22:00–02:30` ending `07:00Z`) and for the overlap exception (NY 2025-11-02 rule `01:30–05:00` contiguous from `05:30Z`).
- [ ] **Step 2: Write invariants** INV-01 … INV-14 exactly as TEST_PLAN §4 words them, against the oracle's availability, not the engine's helpers. INV-03 resubmits slots with `timeZone: "UTC"`; INV-10 fuzzes arbitrary JSON and allows only `INVALID_INPUT` (no `INTERNAL_ERROR` ever expected from fuzzing: assert it never appears, which proves Task 2's split); INV-05 asserts non-decreasing `(|start − rs|, start)`; INV-14 includes greedy maximality.
- [ ] **Step 3: Differential ORC-01** with slots: `evaluate` and the oracle agree on decision, failing participants and the exact ranked slots; horizon ≤ 3 days. Transition oversampling is now on. Any disagreement is a bug to investigate: shrink the failing seed, pin it as a regression `it(...)`, never exclude.
- [ ] **Step 4: Run** `pnpm test` at 200 runs, then once locally `TEMPO_PROP_RUNS=5000` (PowerShell: `$env:TEMPO_PROP_RUNS=5000; pnpm test`; use `cross-env` in any npm script). Expected: PASS.
- [ ] **Step 5: `nightly.yml`**: `schedule: cron "0 3 * * *"` + `workflow_dispatch`, ubuntu-latest, Node 24, `pnpm install --frozen-lockfile`, `TEMPO_PROP_RUNS: 5000`, `pnpm test`. Add a repo test asserting the workflow sets `TEMPO_PROP_RUNS`.
- [ ] **Step 6: Commit** `test(core): full differential oracle and INV-01..14 with DST-weighted generators`.

### Task 7: Close-out, coverage widening and push gate

**Files:**
- Modify: `packages/core/vitest.config.ts` (coverage `include` → all `src/**/*.ts` except tests and `index.ts` re-exports), `packages/core/test/purity.test.ts` (new modules covered by the source scan), `ASSUMPTIONS.md` (A-61 … A-66; mark A-52, A-55 superseded), `DECISIONS.md` (G33 if not already), `TEST_PLAN.md` (mark CORE-24 … CORE-39, CORE-43 and INV rows implemented), `ROADMAP.md` (tick M2b DoD with proving commands), `CLAUDE.md` (Current phase line only), `README`/`SKILL.md` untouched (M4)

- [ ] **Step 1: Code coverage meta-test** `packages/core/test/codes.test.ts`: every member of `ErrorCodeSchema` and `ReasonCodeSchema` (SPEC §3) is produced by at least one named example or test table (assert by running the labelled inputs and collecting `error.code` / `reason.code`; `OK` is explain-only; `INTERNAL_ERROR` via the Task 2 mock path).
- [ ] **Step 2: DOC-02:** a test that every `fixtures/examples/ex-*.json` agrees with a fresh extraction from `SPEC.md` (existing drift test, now with all 24 in the exact tier).
- [ ] **Step 3: Run on a fresh clone** (Windows, Node 24): `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:coverage`, `pnpm build`, `pnpm gen:schema` then `git status --short` empty. Record the numbers in ROADMAP. Expected: all exit 0; core ≥ 95 % lines and branches over **all** of core.
- [ ] **Step 4: Tick ROADMAP M2b DoD** with evidence: EX-01 … EX-24 pass (exact tier is all 24); INV-01 … INV-14 at 200 runs and nightly configured; ORC-01 decisions and slots; INV-06/INV-07; coverage; code coverage meta-test.
- [ ] **Step 5: Commit** `docs: close out M2b`. **Step 6: Push gate:** stop for your approval before `git push origin main` and `gh run watch`; the CI-green DoD item stays unticked until all 4 jobs are green. Do not release (A-53 note is resolved by Task 1, but `suggest`/`explain` are new public API: needs your call on version).

**Known risks:** (1) the oracle's wall-membership model agrees with the engine at gaps by construction (G34); at overlaps the earlier-occurrence exception is the only deviation, so any other disagreement is a bug or an A-nn, never an exclusion. (2) `search.ts` correctness at the horizon edge and with step ∤ 24 h. (3) `transitionMs` bisection in `dst.ts` is on the hot path only for gap boundaries; verify with the 90-day timing in Task 4. (4) `explain` and `evaluate` share `decide()`: a refactor mistake there shows up as CORE-34 failures first.
