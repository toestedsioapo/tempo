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

---

# Round 3 — decisions applied

Source: your round-3 review (independent reference check reproduced all 24 SPEC examples). Each decision is recorded in `DECISIONS.md` as G22 … G29.

## Decisions

| Item | Decision | Applied in |
|---|---|---|
| V2 | Counter-offer suggestions never overlap (G22): rank by C9, then pick greedily, skipping any candidate that overlaps a slot already picked. Overlap is strict (A-27), so touching slots are allowed | SPEC §3.3, §4.7, §6.0, §9; DECISIONS G22; ASSUMPTIONS A-08 (superseded), A-27; TEST_PLAN CORE-43, INV-05, INV-14, ORC-01; ROADMAP M2b; ARCHITECTURE ADR 5; README demo |
| V1 | `start == end` on a request is `INVALID_INPUT`, exit 2 (G23); C7 is now `end < start` ⇒ next day. EX-10 rewritten | SPEC §3.2, §3.4, §4.1, §4.4, EX-10; DECISIONS G23; ASSUMPTIONS A-28; TEST_PLAN EX-10, CORE-29, CORE-42, G-05; ROADMAP M1, M2a |
| A-12 | Exit 4 = internal error (G24) | SPEC §3.4, §5; ROADMAP M3; ARCHITECTURE ADR 8; TEST_PLAN CLI-17; README |
| A-03, A-04, A-05, A-07 | Approved as written (G25 … G28) | ASSUMPTIONS statuses; ARCHITECTURE ADR 4; DECISIONS |
| A1 | `packageManager` `pnpm@12.15.x`, `engines.node >=24` (G29); the old A1 rows are marked superseded, not deleted | DECISIONS A1 rows, G29; ASSUMPTIONS A-21; TEST_PLAN CFG-03, CFG-04; ROADMAP M1 |
| Encoding | `DECISIONS.md` re-saved as UTF-8 (CRLF kept); seven lost `?` characters restored as arrows (A-29) | DECISIONS.md |

## Recomputation of the examples affected by V2

An independent throwaway script (outside the repo, scratchpad) re-ran the C9 search for each affected example with and without the greedy rule. "Without" reproduced the old SPEC output exactly in every case (so the script agrees with the old reference), and "with" matches your expected values exactly. **No disagreement with your list.**

| Example | Old slots (UTC) | New slots (UTC) | Requester-zone starts |
|---|---|---|---|
| EX-04 | 13:00, 13:15, 13:30 (08-12) | 13:00, 14:00, 15:00 | 09:00, 10:00, 11:00 |
| EX-06 | 12:00, 12:15, 12:30 (01-13) | 12:00, 13:00, 14:00 | 20:00, 21:00, 22:00 |
| EX-17 | 03:30, 03:45, 04:00 (01-13) | 03:30, 04:30, 05:30 | 09:15, 10:15, 11:15 |
| EX-18 | 12:00, 12:15, 12:30 (01-20) | 12:00, 13:00, 14:00 | 20:00, 21:00, 22:00 |
| EX-19 | 15:00, 15:15, 15:30 (01-06) | 15:00, 16:00 (01-06), 14:00 (01-07) | 10:00, 11:00, 01-07 09:00 |
| EX-20 | 15:00, 15:15, 15:30 (01-06) | 15:00, 16:00 (01-06), 14:00 (01-07) | 10:00, 11:00, 01-07 09:00 |
| EX-21 | 09:00, 11:00, 08:45 | 09:00, 11:00, 08:00 | 09:00, 11:00, 08:00 |
| README demo | 20:00, 19:45, 19:30 (07-13) | 20:00, 19:00, 18:00 | Manila 04:00, 03:00, 02:00 (07-14) |

Unchanged by V2 (checked): EX-01 … EX-03, EX-05, EX-07 … EX-09, EX-11 … EX-16, EX-22, EX-23, EX-24 (no multiple suggestions, or already non-overlapping).

## Stale lines fixed

`CLAUDE.md` and `PLAN.md` were rewritten to match SPEC and DECISIONS: exit codes `10`/`11` and `1 = internal` replaced by D14 + G24; `needs_clarification` replaced by `AMBIGUOUS_ZONE` (G26); `skills/tempo/SKILL.md` replaced by the root `SKILL.md` (D16); `explain --request … --parties …` replaced by `explain [file]`; the two-party non-goal withdrawn; the PLAN milestone table now mirrors `ROADMAP.md`; `CLAUDE.md` current phase is `IMPLEMENTATION — milestone 1`. The PLAN.md missing final newline was fixed as part of the rewrite.

## New assumptions

A-27 (strict overlap), A-28 (V1 error shape and 23 h 59 min maximum), A-29 (UTF-8 re-save), A-30 (docs stay at the repo root). No row in `ASSUMPTIONS.md` is waiting for approval.
