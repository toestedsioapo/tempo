# Tempo — TEST_PLAN.md

> **Status:** APPROVED (planning round 3). Nothing here is implemented yet. **No production code without a failing test first** (`CLAUDE.md`).
> **Precedence:** `DECISIONS.md` is the source of truth. Section 9 proves every decision row and every SPEC example is covered.
> **Assumptions:** `A-nn` in [`ASSUMPTIONS.md`](./ASSUMPTIONS.md).

---

## 1. Stack and conventions

| Tool | Purpose |
|---|---|
| **Vitest** | unit, table-driven, snapshot and CLI tests (`pnpm test`, `pnpm test:watch`) |
| **fast-check** | property tests in `*.prop.test.ts` |
| **Stryker** (Vitest runner) | mutation testing of `packages/core` |
| **ESLint** | enforces core purity (`no-restricted-globals`/`no-restricted-syntax` for `Date.now`, `new Date`, `process`, `fs`) and forbids `Temporal` imports |
| **Luxon** | the only date-time library in tests; no raw JS `Date` arithmetic |

ID prefixes: `EX-nn` worked example · `CORE-nn` unit · `INV-nn` property · `ORC-nn` oracle · `CLI-nn` CLI · `CFG-nn` repo/config check · `DOC-nn` documentation check · `QG-nn` quality gate · `G-nn` generator.

Rules for every test: fixed `now`, fixed IANA zones, no network, no clock. Core tests call the pure functions directly. A test never reads `Date.now()`; the lint rule applies to test files too, except the single CLI clock test, which injects a fake clock.

## 2. Worked-example tests (`packages/core/test/examples.test.ts`)

Table-driven: one fixture per SPEC example (`fixtures/examples/ex-nn.json` holding `input` and the exact expected output), exported as `@marvinliem/tempo-core/fixtures`. The SPEC output blocks are the expected values, byte for byte (`DOC-02` checks that SPEC.md and the fixtures agree).

| Test | SPEC example | Entry point | Asserts |
|---|---|---|---|
| EX-01 | Same-day book, winter offsets | `evaluate` | exact output (`book`) |
| EX-02 | Request longer than the overlap | `evaluate` | `counter_offer`, `slots: []`, `OUTSIDE_AVAILABILITY(bob)`, `NO_SLOTS_IN_HORIZON` |
| EX-03 | Summer offsets | `evaluate` | exact output (`book`, EDT/BST) |
| EX-04 | Blackout day → counter_offer | `evaluate` | `IN_BLACKOUT(alice)`, slots 13:00/14:00/15:00Z on 2025-08-12 |
| EX-05 | Overnight, start-day ownership | `evaluate` | `book` |
| EX-06 | Request on the wrong owner day | `evaluate` | `counter_offer`, slots 12:00/13:00/14:00Z on 2025-01-13 |
| EX-07 | End 24:00 and merge | `evaluate` | `book` (only possible because touching instances merge) |
| EX-08 | Request crossing midnight | `evaluate` | `book`, duration 2 h |
| EX-09 | Rule start == end | `evaluate` | `INVALID_INTERVAL`, exact `details.field` |
| EX-10 | Request start == end rejected (G23) | `evaluate` | `INVALID_INPUT`, `details.issues[0].path` `request.end`, exact message |
| EX-11 | US spring-forward day | `evaluate` | EDT conversion `[13:00Z, 21:00Z]`; `counter_offer`, `slots: []` |
| EX-12 | US spring-forward gap | `evaluate` | `DST_NONEXISTENT_LOCAL_TIME`, `transitionUtc` |
| EX-13 | US fall-back ambiguity | `evaluate` | `DST_AMBIGUOUS_LOCAL_TIME`, both candidate instants |
| EX-14 | EU spring-forward in a shift | `evaluate` | `book`; instance is 7 h long |
| EX-15 | Sydney fall-back in a shift | `evaluate` | `book`; instance is 9 h long |
| EX-16 | Lord_Howe 30-minute shift | `evaluate` | `book`; instance `[13:30Z, 19:00Z]` |
| EX-17 | +05:30 / +05:45 | `evaluate` | slots 03:30/04:30/05:30Z rendered at +05:45 |
| EX-18 | Blackout blocks an overnight shift | `evaluate` | `IN_BLACKOUT(bob)`, slots 12:00/13:00/14:00Z on 2025-01-20 |
| EX-19 | Request before `now` | `evaluate` | `IN_PAST`, slots 2025-01-06T15:00Z, 2025-01-06T16:00Z, 2025-01-07T14:00Z |
| EX-20 | `minNoticeMinutes` | `evaluate` | `INSUFFICIENT_NOTICE`, slots 2025-01-06T15:00Z, 2025-01-06T16:00Z, 2025-01-07T14:00Z (all ≥ `now` + 120 min) |
| EX-21 | Ranking and tie-break | `evaluate` | slots `[09:00, 11:00, 08:00]` (rank order, not chronological; 08:45, 11:15 … skipped as overlapping) |
| EX-22 | Three participants + trace | `explain` | exact `ExplainResult` |
| EX-23 | Ambiguous “IST” | `evaluate` | `AMBIGUOUS_ZONE`, exact `options` |
| EX-24 | Rule boundary inside a gap | `evaluate` | `book` + `DST_RULE_ADJUSTED`, instance `[07:00Z, 14:00Z]` |

Each example is also run through `suggest` and `explain` for structural consistency (`explain.decision` and `reasons` equal `evaluate`'s; `explain.candidates` equal `evaluate`'s `slots` on a counter_offer; `suggest.slots[0]` equals the requested slot on a `book`).

## 3. Unit tests (`packages/core`)

| ID | What | Expected |
|---|---|---|
| CORE-01 | Valid minimal request | schema accepts; defaults applied (`minNoticeMinutes 0`, `searchHorizonDays 14`, `searchStepMinutes 15`, `maxSuggestions 3`, `blackouts []`) |
| CORE-02 | Fewer than 2 participants (D13) | `INVALID_INPUT`, `details.issues` path `participants` |
| CORE-03 | Duplicate `partyId` | `INVALID_INPUT` |
| CORE-04 | Bad formats: `2025-02-30`, `9:00`, `now` with an offset, `now` as a number, missing `now` | `INVALID_INPUT` with the offending path (table-driven) |
| CORE-05 | Weekday keys | `monday`…`sunday` accepted; `Monday`, `mon`, `1` rejected |
| CORE-06 | Option bounds | out-of-range `searchHorizonDays` (0, 91), `searchStepMinutes` (0, 1441), `maxSuggestions` (0, 11) rejected (A-10) |
| CORE-07 | `"24:00"` | accepted as a rule `end`; rejected as a rule `start` and as a request `start`/`end` (A-24) |
| CORE-08 | Each abbreviation in SPEC §7 | `AMBIGUOUS_ZONE` with exactly the listed `options`, in order (7 rows) |
| CORE-09 | `UTC`, `GMT`, `Etc/UTC` accepted; `ist` (lowercase) ambiguous | per C11 / A-14 |
| CORE-10 | `Mars/Olympus`, `""`, `" UTC"` | `INVALID_ZONE` |
| CORE-11 | Validation order | ambiguous zone in `participants[1]` + invalid interval in `participants[0]` ⇒ the zone error; `request.timeZone` is checked before participants |
| CORE-12 | Weekday is read in each party’s own zone | one UTC instant that is Monday in New York and Tuesday in Manila uses `monday` for one and `tuesday` for the other |
| CORE-13 | Split shift, request in the gap | `counter_offer` |
| CORE-14 | Merge | overlapping and touching instances merge; instances separated by 1 minute do not |
| CORE-15 | Closed boundary | request ending exactly at availability end ⇒ `book`; 1 minute later ⇒ `counter_offer` |
| CORE-16 | Blackout is read in the party’s zone | a date whose UTC day differs from its local day blocks the right instances |
| CORE-17 | Blackout on the day *after* an overnight start | does not block (EX-18 note) |
| CORE-18 | Empty `blackouts` / absent | no effect |
| CORE-19 | Weekend-only availability | `book` on Saturday and Sunday |
| CORE-20 | Participant with `weeklyRules: {}` | never available; `OUTSIDE_AVAILABILITY` |
| CORE-21 | `IN_BLACKOUT` vs `OUTSIDE_AVAILABILITY` | blackout is reported only when the interval would otherwise fit; at most one failure reason per participant |
| CORE-22 | `requested.start == now` | passes; one second earlier ⇒ `IN_PAST` |
| CORE-23 | `requested.start == now + minNotice` | passes; one second earlier ⇒ `INSUFFICIENT_NOTICE` |
| CORE-24 | DST context independent of `now` (C8) | the same request with `now` a year apart yields identical instants |
| CORE-25 | Step respected | every slot start ≡ requested start (mod `searchStepMinutes`), also with `searchStepMinutes: 30` |
| CORE-26 | Horizon edge | a slot exactly `searchHorizonDays` × 24 h away is included; one step beyond is not |
| CORE-27 | `maxSuggestions` | default 3; 1 and 10 honoured |
| CORE-28 | Tie-break | for equal distance the earlier start ranks first (several lattice offsets, not only EX-21), including when the tied candidates are not both picked |
| CORE-29 | Candidate duration equals request duration | including the longest expressible request, 23 h 59 min (A-28) |
| CORE-30 | `suggest` on a bookable request | `slots[0]` is the requested slot (distance 0) |
| CORE-31 | Reason ordering | global → participants by `partyId` → `NO_SLOTS_IN_HORIZON` (A-11) |
| CORE-32 | Rendering | `start`/`end` are ISO with numeric offset in `request.timeZone`; zones `UTC` and `GMT` render `Z`; UTC fields end in `Z`; never a floating local time |
| CORE-33 | `explain` trace | `ruleMatched.ownerDate` is the start day for an overnight match; `null` on failure; `checks` sorted by participant; `candidates` is `[]` on `book` |
| CORE-34 | `explain` agrees with `evaluate` | same `decision`, `reasons`; candidates equal `slots` |
| CORE-35 | Gap detection per fixture zone | `America/New_York 2025-03-09 02:00–02:59`, `Europe/Berlin 2025-03-30 02:30`, `Australia/Sydney 2025-10-05 02:30`, `Australia/Lord_Howe 2025-10-05 02:15` ⇒ nonexistent; `Asia/Manila` never |
| CORE-36 | Overlap detection per fixture zone | `America/New_York 2025-11-02 01:00–01:59`, `Europe/Berlin 2025-10-26 02:30`, `Australia/Sydney 2025-04-06 02:30`, `Australia/Lord_Howe 2025-04-06 01:45` ⇒ ambiguous; `Asia/Manila` never |
| CORE-37 | Times next to a transition | `New_York 2025-03-09 01:59` and `03:00`, `2025-11-02 00:59` and `02:00`, `Lord_Howe 2025-10-05 02:30` are valid and unique |
| CORE-38 | Rule-boundary policy (A-07) | gap boundary ⇒ transition instant (G34); overlap boundary ⇒ earlier occurrence; rule wholly inside a gap ⇒ dropped; `DST_RULE_ADJUSTED` only when the adjusted instance overlaps the request |
| CORE-39 | Request `end` in a gap/overlap | error with `details.field: "request.end"` |
| CORE-40 | Purity | lint/static check: core imports only `luxon` and `zod`, uses no forbidden globals; the compiled bundle contains no `Date.now` |
| CORE-41 | Schema drift | regenerating `schema/rules.schema.json` reproduces the committed file; every `fixtures/examples/*.json` input validates against it |
| CORE-42 | Request `start == end` (G23) | `INVALID_INPUT` with `details.issues[0].path` `request.end` (exact message in EX-10); `end < start` still means next day; `start: 00:00`, `end: 00:00` is also rejected |
| CORE-43 | Non-overlapping selection (G22) | greedy over the ranked candidates: an overlapping candidate is skipped and never revisited; touching slots are both kept (A-27); fewer than `maxSuggestions` slots are returned when the horizon runs out |
| CORE-44 | Output schemas and closed enums | `NegotiationResult`, `ExplainResult`, `ErrorResult` and the slot and reason shapes are strict Zod schemas; `ErrorCode` and `ReasonCode` are closed enums that match SPEC §3 exactly. Tests: `packages/core/src/output-schema.test.ts` |
| CORE-45 | CLI exit-code mapping | every `ErrorCode` maps to exit `2`, `3` or `4` per D14, and the constants `0/1/2/3/4` are fixed (public API). Tests: `packages/cli/src/exit-codes.test.ts` |

## 4. Property-based invariants (`*.prop.test.ts`, fast-check)

Properties are checked against the independent oracle’s definition of availability (§5), not against the engine’s own helpers.

| ID | Property |
|---|---|
| INV-01 | `book` ⇒ for every participant the requested instant range lies fully inside that participant’s availability (oracle) |
| INV-02 | Every returned slot has `start < end` and duration equal to the request duration |
| INV-03 | **Re-submission (E17):** every returned slot, re-submitted as a request (expressed with `timeZone: "UTC"` so no wall time is ambiguous; A-26), yields `book` with the same instants |
| INV-04 | Every returned slot lies inside every participant’s availability, outside every blackout-blocked instance, and at or after `now + minNoticeMinutes` |
| INV-05 | Slots are in rank order of the lattice (non-decreasing `(|start − requestedStart|, start)` — a skipped candidate never makes a later pick rank earlier), unique, and at most `maxSuggestions` |
| INV-06 | **Determinism:** two runs on the same input (including `now`) give byte-identical JSON |
| INV-07 | **Participant-swap symmetry (E17):** any permutation of `participants` gives an identical result |
| INV-08 | **Blackout monotonicity (E17):** adding a blackout never turns `counter_offer` into `book` and never adds a fitting candidate (the set of fitting lattice points only shrinks) |
| INV-09 | Round trip: formatting `startUtc` in the requester zone and parsing the result gives the same instant |
| INV-10 | **Never throws:** for arbitrary JSON values (including `null`, huge numbers, deep nesting, hostile strings) core returns `{ ok: true … }` or `{ ok: false, error }` with a code from the closed enum |
| INV-11 | Equivalent request, different zone: restating the same instants in another zone (when its wall times are unambiguous) gives the same decision and the same UTC slots |
| INV-12 | Overnight rules (`end < start`) never crash; each instance is owned by its start day; its real length equals the nominal wrap length plus the DST delta within the interval |
| INV-13 | Availability monotonicity: adding an availability rule never turns `book` into `counter_offer` |
| INV-14 | **No overlap (G22):** for every pair of returned slots, `a.start >= b.end` or `b.start >= a.end`; and greedy maximality: every fitting candidate ranked above a returned slot either was returned or overlaps an earlier returned slot |

**Generators (E18).** Zones: `America/New_York`, `Europe/Berlin`, `Australia/Sydney`, `Australia/Lord_Howe`, `Asia/Manila` (no DST), `Asia/Kolkata` (+05:30), `Asia/Kathmandu` (+05:45), `UTC`. Dates: at least 50% within ±2 days of a transition of the chosen zone (G-01, transitions found by scanning with Luxon in a test helper). Wall times: at least 50% drawn from `00:00–04:00` where gaps and overlaps live (G-02). Rules: overnight, `24:00` ends, touching and overlapping intervals, split shifts (G-03). Blackouts: owner dates, the day after an owner date, and dates that differ between UTC and the party’s zone (G-04). Request durations 15 min–23 h 59 min (G-05). Run counts: 200 on PR, 5,000 nightly; failing seeds are printed and pinned as regression tests.

## 5. Differential oracle (E17)

| ID | What |
|---|---|
| ORC-01 | A brute-force **minute-by-minute UTC oracle** shares no code with the engine. For each participant and each UTC minute in the window it asks directly: “converting this instant to the party’s zone, is it inside some rule instance (by local date and wall time) whose owner date is not blacked out?” Availability of an interval is “every minute inside is available”; candidate slots are found by scanning the lattice and are selected by the oracle’s own, separately written implementation of the greedy non-overlap rule (G22). Differential property: for generated inputs, `evaluate` and the oracle agree on the decision, the failing participants and the exact ranked slots. |
| ORC-02 | The oracle itself is validated against all 24 SPEC examples before it is trusted. |

The oracle may be slow (it scans minutes); generators keep the horizon small (`searchHorizonDays ≤ 3`) for ORC-01.

## 6. CLI tests (`packages/cli`, snapshot where noted)

Run on Linux and Windows in CI. Snapshots live in `packages/cli/test/__snapshots__/`; update only intentionally and say why in the PR.

| ID | Command / input | Asserts |
|---|---|---|
| CLI-01 | `tempo check --json` on EX-01 | exit `0`; stdout JSON equals the SPEC output |
| CLI-02 | `tempo check --json` on a counter_offer (EX-17) | exit `0` |
| CLI-03 | same with `--exit-code` | exit `1`; EX-01 with `--exit-code` exits `0` (D14) |
| CLI-04 | `tempo suggest --json` on EX-17, with and without `--exit-code` | ranked alternatives; exit `0` / `1` |
| CLI-05 | `tempo explain --json` on EX-22 | exit `0`; stdout equals the SPEC `ExplainResult` (snapshot) |
| CLI-06 | malformed JSON; unreadable path | exit `2`, `INVALID_INPUT` on stdout with `--json`, a single line on stderr without it |
| CLI-07 | missing required fields | exit `2` |
| CLI-08 | EX-23 (`IST`) | exit `3`; stdout JSON includes `options`. (Core builds the object, CORE-08; this test checks only the exit-code mapping, which removes the old CORE-10/CLI-05 overlap.) |
| CLI-09 | EX-12 and EX-13 | exit `2` for both DST errors |
| CLI-10 | `--now` precedence | `--now` > `options.now` in the file > the injected fake clock |
| CLI-11 | input via file, via stdin, via `-` | identical output |
| CLI-12 | input file with a UTF-8 BOM | accepted (Windows PowerShell 5.1) |
| CLI-13 | no TTY and no input | exits `2` immediately; never waits or prompts |
| CLI-14 | human-readable output for `check`, `suggest`, `explain` | snapshots (not public API; A-13) |
| CLI-15 | `--help`, `--version` | exit `0` |
| CLI-16 | unknown command or flag | exit `2` |
| CLI-17 | injected internal failure | exit `4`, `INTERNAL_ERROR` (G24) |
| CLI-18 | path with spaces; CRLF input; Windows-style paths | works on the windows-latest job |
| CLI-19 | the README demo (F21) | running `explain --json` on the README’s input reproduces the README’s output exactly |

## 7. Edge-case catalogue (exported as fixtures for Deskbench; keep stable)

| Edge | Handling | SPEC | Tests |
|---|---|---|---|
| Spring-forward gap (02:30 does not exist) | `DST_NONEXISTENT_LOCAL_TIME`, exit 2, never shifted | EX-12 | CORE-35, CORE-39 |
| Fall-back overlap (01:30 occurs twice) | `DST_AMBIGUOUS_LOCAL_TIME`, exit 2, both instants reported | EX-13 | CORE-36 |
| Times adjacent to a transition | valid and unique | EX-16 | CORE-37 |
| Overnight shift, start-day ownership | owner = start day | EX-05, EX-06 | CORE-12, INV-12 |
| Overnight wrap across a DST change | real length ≠ nominal | EX-14, EX-15, EX-16 | INV-12, ORC-01 |
| Blackout on the start day of an overnight shift | whole shift blocked | EX-18 | CORE-16, CORE-17 |
| Blackout on the request date | `counter_offer`, `IN_BLACKOUT` | EX-04 | CORE-21, INV-08 |
| Split shift, request in the gap | `counter_offer`; ranking around the gap | EX-21 | CORE-13, CORE-28 |
| Zero mutual availability | `counter_offer`, `slots: []`, `NO_SLOTS_IN_HORIZON` | EX-02, EX-11 | CORE-20 |
| `end: "24:00"` and touching intervals | merge | EX-07 | CORE-14 |
| Request crossing midnight; request with `start == end` | next day; `INVALID_INPUT` (G23) | EX-08, EX-10 | CORE-29, CORE-42 |
| Rule with `start == end` | `INVALID_INTERVAL` | EX-09 | CORE-07 |
| Ambiguous abbreviation (IST…) | `AMBIGUOUS_ZONE`, exit 3 | EX-23 | CORE-08, CLI-08 |
| Unknown zone | `INVALID_ZONE`, exit 2 | — | CORE-10 |
| Missing or non-ISO `now` | `INVALID_INPUT` | — | CORE-04 |
| Request before `now`; insufficient notice | `IN_PAST`; `INSUFFICIENT_NOTICE` | EX-19, EX-20 | CORE-22, CORE-23 |
| +05:30 / +05:45 offsets; Lord_Howe 30-minute shift | exact minute arithmetic | EX-16, EX-17 | G-01, ORC-01 |
| Rule boundary in a DST gap | transition instant (G34) + `DST_RULE_ADJUSTED`; overlap = earlier occurrence | EX-24 | CORE-38 |
| Participant order | irrelevant | EX-22 | INV-07 |

## 8. Quality gates

| ID | Gate |
|---|---|
| QG-01 | `packages/core` ≥ 95% line **and** branch coverage; 100% of public functions covered (A-23) |
| QG-02 | Stryker mutation score ≥ 70% (break threshold) on `packages/core` (A-23) |
| QG-03 | CI matrix: Node 24 and 26 × ubuntu-latest and windows-latest; all four must pass |
| QG-04 | `pnpm typecheck` and `pnpm lint` clean (no `any` escapes in core, purity rules from §1) |
| QG-05 | Fixture files are append-only: removing or changing an existing fixture needs a changeset marked breaking |

## 9. Traceability

### 9.1 SPEC example → tests

| SPEC | Primary test | Also covered by |
|---|---|---|
| EX-01 | EX-01 | CLI-01, CLI-03, INV-01 |
| EX-02 | EX-02 | CORE-29 |
| EX-03 | EX-03 | — |
| EX-04 | EX-04 | CORE-21, INV-08 |
| EX-05 | EX-05 | CORE-12, INV-12 |
| EX-06 | EX-06 | INV-12 |
| EX-07 | EX-07 | CORE-14 |
| EX-08 | EX-08 | CORE-29 |
| EX-09 | EX-09 | CORE-07 |
| EX-10 | EX-10 | CORE-42 |
| EX-11 | EX-11 | CORE-12 |
| EX-12 | EX-12 | CORE-35, CLI-09 |
| EX-13 | EX-13 | CORE-36, CLI-09 |
| EX-14 | EX-14 | INV-12, ORC-01 |
| EX-15 | EX-15 | INV-12, ORC-01 |
| EX-16 | EX-16 | CORE-37, ORC-01 |
| EX-17 | EX-17 | CLI-02, CLI-04, CORE-25 |
| EX-18 | EX-18 | CORE-16, CORE-17 |
| EX-19 | EX-19 | CORE-22 |
| EX-20 | EX-20 | CORE-23 |
| EX-21 | EX-21 | CORE-28 |
| EX-22 | EX-22 | CORE-33, CORE-34, CLI-05, INV-07 |
| EX-23 | EX-23 | CORE-08, CLI-08 |
| EX-24 | EX-24 | CORE-38 |

### 9.2 Repo and documentation checks

| ID | Check |
|---|---|
| CFG-01 | root `package.json` has no `@my-workspace/shared-ui` dependency |
| CFG-02 | root `package.json` has no `workspaces` field |
| CFG-03 | `packageManager` is `pnpm@12.15.x` (G29 supersedes the `9.12.3` in A1) |
| CFG-04 | `engines.node` is `>=24` (G29 supersedes the `>=20` in A1) |
| CFG-05 | root scripts `build`, `typecheck`, `lint`, `test` exist; `test` does not pass `--passWithNoTests` through pnpm |
| CFG-06 | `pnpm-workspace.yaml` lists exactly `packages/*` |
| CFG-07 | core `dependencies` are exactly `luxon` and `zod`; no `Temporal` import anywhere in core |
| CFG-08 | no file named `dts.ts` anywhere under `packages/` (active in M1). Split per A-36: `packages/core/src/dst.ts` exists (`it.todo` until M2b) and `SKILL.md` exists at the repo root (`it.todo` until M4) |
| CFG-09 | every fenced example in `SKILL.md` parses, and its documented exit codes match CLI behaviour |
| CFG-10 | `pnpm check:names` confirms `@marvinliem/tempo-core` and `@marvinliem/tempo` are available (or owned) on npm — the Milestone 1 gate (F20) |
| CFG-11 | `.changeset/config.json` exists; release workflow publishes with provenance and contains no token |
| DOC-01 | every `A-nn` referenced in a doc exists in `ASSUMPTIONS.md` |
| DOC-02 | each SPEC output block equals the matching `fixtures/examples/ex-nn.json` expectation |
| DOC-03 | README demo input and output are reproducible (CLI-19) |

### 9.3 DECISIONS row → test or invariant

| Decision | Covered by |
|---|---|
| A1 remove `shared-ui` dependency | CFG-01 |
| A1 remove `workspaces` field | CFG-02 |
| A1 `packageManager` pin | CFG-03 |
| A1 `engines.node` | CFG-04 |
| A1 root scripts | CFG-05 |
| A2 `packages: ['packages/*']` | CFG-06 |
| C5 interval algebra, `24:00`, `start == end` | EX-05, EX-06, EX-07, EX-09; CORE-07, CORE-12, CORE-14, CORE-15; INV-12; ORC-01 |
| C6 blackout in the party’s zone | EX-04, EX-18; CORE-16, CORE-17, CORE-21; INV-08 |
| C7 request `end < start` ⇒ next day (amended by G23) | EX-08, EX-10; CORE-29, CORE-42 |
| C8 `now`, `minNoticeMinutes`, request before `now` | EX-19, EX-20; CORE-04, CORE-22, CORE-23, CORE-24; INV-04 |
| C9 search horizon, step, ranking, tie-break | EX-17, EX-21; CORE-25 … CORE-28, CORE-30; INV-05 |
| C10 nonexistent and ambiguous local times | EX-12, EX-13; CORE-35 … CORE-39 |
| C11 zone validation before Luxon | EX-23; CORE-08 … CORE-11; CLI-08 |
| C12 keep Luxon, not Temporal | CFG-07; CORE-40 |
| D13 `participants[]`, errors as values | EX-22; CORE-02, CORE-03; INV-07, INV-10 |
| D14 exit codes, `--exit-code` | CLI-01 … CLI-05, CLI-08, CLI-09 |
| D15 `ExplainResult` | EX-22; CORE-33, CORE-34; CLI-05 |
| D16 `dst.ts`, root tool-agnostic `SKILL.md` | CFG-08, CFG-09 |
| E17 oracle, differential, symmetry, monotonicity, re-submission, determinism | ORC-01, ORC-02; INV-03, INV-06, INV-07, INV-08 |
| E18 DST-day oversampling; +5:30, +5:45, Sydney, Lord_Howe | G-01 … G-05; EX-16, EX-17; CORE-35, CORE-36 |
| E19 branch coverage, Stryker, no CORE-10/CLI-05 overlap, CI on Linux and Windows | QG-01, QG-02, QG-03; CORE-08 vs CLI-08 split |
| F20 milestone split, name gate, changesets, concrete DoD | CFG-10, CFG-11; ROADMAP review (doc) |
| F21 README demo | CLI-19, DOC-03 |
| G22 non-overlapping suggestions (amends C9) | EX-04, EX-06, EX-17 … EX-21; CORE-43; INV-14; ORC-01 |
| G23 request `start == end` is `INVALID_INPUT` (amends C7) | EX-10; CORE-42 |
| G24 exit 4 = internal error | CLI-17 |
| G25 entry points `evaluate`, `suggest`, `explain` | EX-01 … EX-24 (entry-point column); CLI-01 … CLI-05 |
| G26 ambiguous zone is an error, exit 3 | EX-23; CORE-08; CLI-08 |
| G27 DST request times are input errors, exit 2 | EX-12, EX-13; CORE-35, CORE-36, CORE-39 |
| G28 rule-boundary policy | EX-24; CORE-38 |
| G29 `pnpm@12.15.x`, `node >=24` | CFG-03, CFG-04 |
