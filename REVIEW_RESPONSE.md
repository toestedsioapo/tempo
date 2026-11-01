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
