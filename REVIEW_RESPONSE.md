# Tempo - Review Response

This document maps each numbered review item to the file and section where it was fixed.

## A. Config

| Item | Fix | File | Section |
|------|-----|------|---------|
| A1 | Removed @my-workspace/shared-ui dependency and workspaces field; added packageManager, engines, scripts | package.json | Root |
| A2 | packages: [packages/*] only | pnpm-workspace.yaml | Root |

## B. SPEC.md

| Item | Fix | File | Section |
|------|-----|------|---------|
| B3 | Restored structure: Example 8 lines moved back; NegotiationResult defined with IsoSlot; ErrorResult added | SPEC.md | Section 4, Section 6 |
| B4 | All worked examples deterministic (no "or" outcomes); verified by hand | SPEC.md | Section 6 |

## C. Semantics

| Item | Fix | File | Section |
|------|-----|------|---------|
| C5 | Weekly intervals to absolute UTC; merge adjacent/overlapping; end 24:00 allowed; start == end rejected | SPEC.md | Section 5 |
| C6 | Blackout dates block intervals starting on that date | SPEC.md | Section 5 |
| C7 | end <= start -> next day (max 24 hours) | SPEC.md | Section 5 |
| C8 | now: ISO-8601 UTC string only; lower bound for slots | SPEC.md, ARCHITECTURE.md | Section 5, Section 5 |
| C9 | Counter-offer search: horizon 14, 15-min step, rank by distance | SPEC.md, TEST_PLAN.md | Section 5, Section 3 |
| C10 | Nonexistent AND ambiguous local time both rejected | SPEC.md, ARCHITECTURE.md | Section 4, ADR 1 |
| C11 | Zone validation before Luxon; IST options corrected | ARCHITECTURE.md | ADR 2 |
| C12 | Keep Luxon; real reasons (maturity, ecosystem, DST helpers) | ARCHITECTURE.md | ADR 1 |

## D. API and CLI

| Item | Fix | File | Section |
|------|-----|------|---------|
| D13 | participants: PartyRules[] (min 2); core returns { ok: false, error } | SPEC.md, ARCHITECTURE.md | Section 4, Section 2 |
| D14 | Exit 0 on success; --exit-code flag; errors always 2 or 3 | SPEC.md, ARCHITECTURE.md, TEST_PLAN.md, README.md | Section 5, Section 6, Section 3, CLI table |
| D15 | tempo explain: ExplainResult with per-participant reasonCode | SPEC.md, ARCHITECTURE.md | Section 4, Section 2 |
| D16 | dts.ts -> dst.ts; SKILL.md tool-agnostic | ARCHITECTURE.md | Section 1, Section 4 |

## E. TEST_PLAN

| Item | Fix | File | Section |
|------|-----|------|---------|
| E17 | Brute-force UTC oracle; participant-swap symmetry; blackout monotonicity; slot re-submission; determinism | TEST_PLAN.md | Section 2, Section 3 |
| E18 | Generators oversample DST days; zones: +5:30, +5:45, Sydney, Lord_Howe | TEST_PLAN.md | Section 3 |
| E19 | Branch coverage + Stryker; CORE-10/CLI-05 overlap removed; CI on Linux and Windows | TEST_PLAN.md | Section 6 |

## F. ROADMAP and README

| Item | Fix | File | Section |
|------|-----|------|---------|
| F20 | Milestone 2 split into 2a/2b; npm-scope gate in Milestone 1; changesets; concrete checklist | ROADMAP.md | M1, M2 |
| F21 | README demo: consistent dates/weekday/now; slot inside both hours; explain trace; PowerShell-safe example | README.md | Demo |

## New Files

| File | Purpose |
|------|---------|
| DECISIONS.md | Decision log with reasons and veto notes |
| .clinerules | "Planning documents only until I explicitly approve" |
| REVIEW_RESPONSE.md | This document |

---

# Round 2

Goal: bring the planning docs to an approvable state. Documents only; no implementation code was written or fixed. `DECISIONS.md` was treated as the source of truth and was **not edited** (it is Windows-1252 encoded; see the approval checklist). Every fix below was verified; see “Verification” at the end.

## Round 2 table: problem → fix → file/section

| # | Problem | Fix | File / section |
|---|---------|-----|----------------|
| 1a | Ex1: request `14:00Z–19:00Z` runs past London 09:00–17:00 GMT (= `17:00Z`), so it cannot be `book` | Replaced by EX-01 (a request that fits: `14:30Z–15:30Z`) and EX-02 (the original 5 h request, now a `counter_offer` with `slots: []`, `OUTSIDE_AVAILABILITY(bob)`, `NO_SLOTS_IN_HORIZON`) | SPEC §6 EX-01, EX-02 |
| 1b | Ex2: 2025-03-09 is the US spring-forward day; NY 09:00 is EDT (−04:00); Sydney 15:00–23:00 AEDT = `04:00Z–12:00Z`; old numbers (EST, “04:00Z–22:00Z”) were wrong | Recomputed: NY `[13:00Z, 21:00Z]`, Sydney `[04:00Z, 12:00Z]`, no overlap; request `13:00Z–16:00Z` fails Bob; `counter_offer`, no slots | SPEC §6 EX-11 |
| 1c | Ex3/Ex4 said EST in June/August | EDT (−04:00) throughout; Ex3 also claimed “no overlap” but the June windows coincide exactly (`13:00Z–21:00Z`) | SPEC §6 EX-03, EX-04 |
| 1d | Ex4 returned an error for a blackout | Now a `counter_offer` with `IN_BLACKOUT` and ranked slots on the next unblocked day (C6/C8/C9) | SPEC §6 EX-04 |
| 1e | §3.3 `NegotiationResult` truncated; `ExplainResult`, `ErrorResult`, reason codes undefined | Defined fully: `NegotiationOk`, `IsoSlot`, `Reason`, `ErrorResult` + `ErrorCode` table with exit codes, `ReasonCode` enum with exact message templates, `ExplainResult` / `CandidateTrace` / `ParticipantCheck` / `RuleRef` (D15) | SPEC §3.3 – §3.6 |
| 1f | Needed 15+ worked examples with input, local→UTC expansion per participant, merged intervals and exact output | 24 examples, each with the offsets used, expansions, merged intervals, evaluation and the exact JSON output; UTC conversions computed from the IANA data (Luxon 3.7.2, scratch script outside the repo) and hand-checked. Coverage: same-day book, overnight wrap (C5), end `24:00`, `start == end`, request crossing midnight (C7), US gap, US overlap, EU transition, Sydney, Lord_Howe (30 min), +05:30 and +05:45, blackout on an overnight shift (C6), before `now` (C8), `minNoticeMinutes`, ranking + tie-break (C9), three participants (D13), `IST` → exit 3 (C11) | SPEC §6 (index in §6.1) |
| 1g | SPEC types could not express overnight ownership (`availability` had no weekday); per-party notice; “vacation day” text | `weeklyRules` keyed by weekday; global `minNoticeMinutes`; semantics rewritten as §4 (assumptions A-01, A-02) | SPEC §3.2, §4 |
| 2 | Docs inconsistent with D13 / D14 / D15; ROADMAP M3 contradicted D14 (`1 = counter_offer` unconditionally) | D14 exit codes everywhere: `0` success, `--exit-code` maps `book→0` / `counter_offer→1`, `2` input, `3` ambiguous zone (`4` internal, pending A-12); `participants[]` (min 2) everywhere; `suggest` no longer has its own 0/1 meaning; “two parties” non-goal withdrawn | SPEC §2, §5, §8; ARCHITECTURE ADR 6–8, §5; ROADMAP M3; TEST_PLAN §6; README CLI table |
| 3 | `@tempo` scope is not mine; first release must be v0.1.0 | `@marvinliem/tempo-core` (library) and `@marvinliem/tempo` (CLI, binary `tempo`) in every doc; M6 releases `v0.1.0`; M1 has a real npm-name availability gate (CFG-10) instead of the old `publishConfig` hack | all docs; ARCHITECTURE §1; ROADMAP M1, M6 |
| 4 | Toolchain not recorded | Node `>=24`; CI Node 24 + 26 × ubuntu + windows; pnpm 12; Vitest + fast-check; TypeScript strict + `noUncheckedIndexedAccess`; ESM with `NodeNext`; Luxon + Zod; changesets; Stryker | ARCHITECTURE §1; ASSUMPTIONS A-21, A-22 |
| 5 | SPEC §1 called Tempo a “planning-review CLI” | Overview rewritten to match PLAN.md: library + CLI for cross-time-zone meeting negotiation, generalizing the n8n Meeting Scheduler | SPEC §1 |
| 6 | Pre-approval code in `packages/` does not build | Not fixed. M1 deletes `packages/*/src` and restarts test-first (history: `5f8ae8c`); root `test` script wrongly passes `--passWithNoTests` to pnpm, to be replaced | ROADMAP M1 (1, 3); ARCHITECTURE §1 “Existing code” |
| 7 | TEST_PLAN had no traceability | Traceability tables: SPEC example → test (24 rows), repo/doc checks, and every DECISIONS row (A1×5, A2, C5–C12, D13–D16, E17–E19, F20, F21) → tests or invariants | TEST_PLAN §9 |

## Further defects found while doing the above (all fixed)

| Defect | Fix | File / section |
|---|---|---|
| ADR 1 said Temporal is “Stage 3”; C12 says Stage 4 / Node 26 and gives different reasons | Rationale rewritten to C12 | ARCHITECTURE ADR 1 |
| ADR 2 treated `GMT` as ambiguous; IST options included `America/New_York` | `UTC`/`GMT` allowed (C11); full options table | ARCHITECTURE ADR 2; SPEC §7 |
| ADR 3 allowed epoch milliseconds for `now` | ISO-8601 UTC string only (C8) | ARCHITECTURE ADR 3; TEST_PLAN CLI-10 |
| TEST_PLAN CORE-09 said Luxon’s resolution of an ambiguous time is acceptable; CORE-14 said `now` changes DST context | Contradicted C10 and C8; now CORE-36 and CORE-24 | TEST_PLAN §3 |
| INV-05 and ROADMAP said slots are “sorted ascending by start”; C9 ranks by distance | Rank order everywhere | SPEC §4.7; TEST_PLAN INV-05; ROADMAP M2b |
| CORE-21 … CORE-24 (oracle, symmetry, monotonicity, re-submission) were listed as unit tests | Moved to INV-03, INV-07, INV-08, ORC-01 | TEST_PLAN §4, §5 |
| Coverage target 90% (TEST_PLAN) vs 95% (PLAN) | 95% line and branch; recorded as A-23 | TEST_PLAN QG-01 |
| ROADMAP 2a/2b had duplicated and swapped Definitions of Done | Separate, concrete checklists | ROADMAP M2a, M2b |
| README claimed `suggest` exits `0 = slots found, 1 = no slots`; demo dates/weekdays/participants did not line up | D14 table; new demo computed and reproducible (Mon 2026-07-13, `now` in the input) | README |
| `DECISIONS.md` A1 records `pnpm@9.12.3` and `node >=20`, contradicting instruction 4 | **Not edited.** Listed in the approval checklist | — |

## New file

| File | Purpose |
|---|---|
| ASSUMPTIONS.md | Register of every assumption `A-01 … A-26`, marking the ones that need approval |

## Not changed (outside this session’s file list)

`CLAUDE.md` and `PLAN.md` still contain lines that predate the locked decisions: exit codes `10`/`11`, the `needs_clarification` decision, `skills/tempo/SKILL.md`, `explain --request … --parties …`, and the two-party non-goal. They are listed in the approval checklist rather than silently edited.

## Verification

* Every UTC conversion in SPEC §6 was computed from the IANA database with Luxon 3.7.2 and checked by hand against the transition dates (US 2025-03-09 / 11-02, EU 2025-03-30, Sydney 2025-04-06, Lord_Howe 2025-10-05, Manila none).
* The SPEC output blocks and the README demo were generated by a throwaway reference model kept outside the repo (scratchpad), never committed; its results were compared with independent hand calculations for each example. It is a documentation aid, not an implementation.
* Cross-references (`A-nn`, `EX-nn`, test IDs, decision rows) were checked by script for existence and consistency.
* Stale-term search across all docs (`@tempo`, `negotiate`, `v1.0.0`, `dts.ts`, `Stage 3`, `needs_clarification`, epoch `now`, old exit codes).
