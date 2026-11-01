# Tempo — TEST_PLAN.md

> **Status:** Draft (planning only — no implementation code)
> **Mode:** Plan-mode deliverable. Review and approve before any scaffolding or code.

---

## 1. Testing Stack

| Tool | Purpose |
|------|---------|
| **Vitest** | Unit test runner, type-aware, fast |
| **fast-check** | Property-based testing (invariants) |
| **Zod** | Input/output schema validation (tested alongside core) |
| **Luxon** | All date/time math in tests (no `Date`) |

---

## 2. Unit Tests (`@tempo/core`)

Each test is pure: fixed `now`, fixed IANA zones, no network, no clock.

| Test ID | Description | Expected |
|---------|-------------|----------|
| CORE-01 | Same-zone, within hours | `decision: "book"` |
| CORE-02 | Different zones, overlap exists | `decision: "book"` |
| CORE-03 | Different zones, no overlap | `decision: "counter_offer"`, slots ≤ 3 |
| CORE-04 | Overnight window (20:00–06:00) covers request | `decision: "book"` |
| CORE-05 | Overnight window wraps midnight, request spans boundary | evaluated correctly, no silent shift |
| CORE-06 | Split shifts, request in gap | `decision: "counter_offer"` |
| CORE-07 | Blackout date, full-day | `decision: "counter_offer"`, reason cites date |
| CORE-08 | DST spring forward, nonexistent local time | rejection reason, no silent shift |
| CORE-09 | DST fall back, ambiguous local time | Luxon resolves to valid offset; documented |
| CORE-10 | Ambiguous abbreviation (IST) → structured error | exit-code-3 equivalent in core result |
| CORE-21 | Brute-force minute-by-minute UTC oracle | Regenerate expected slots with an independent oracle; differential test |
| CORE-22 | Participant-swap symmetry | Swap partyA/partyB; result identical |
| CORE-23 | Blackout monotonicity | Add blackout; result does not improve (slots shrink or stay) |
| CORE-24 | Slot re-submission idempotency | Re-submitting the book slot returns the same slot, decision "book" |
| CORE-11 | Request outside all working hours | `counter_offer`, slots ≤ 3 or `[]` |
| CORE-12 | Both parties blacked out same date | `counter_offer`, slots on adjacent days |
| CORE-13 | Zero mutual availability | `counter_offer`, `slots: []` |
| CORE-14 | `now` injected changes DST context | deterministic with fixed `now` |
| CORE-15 | Output slots are ISO-8601 with offsets | no floating local times |
| CORE-16 | Zod schema rejects invalid request shape | validation error |
| CORE-17 | Zod schema accepts valid request shape | passes |
| CORE-18 | Per-weekday lowercase keys accepted | "monday"… "sunday" |
| CORE-19 | Weekend-only availability | `book` on saturday/sunday |
| CORE-20 | Blackout dates array empty → no effect | behaves as no blackouts |

---

## 3. Property-Based Invariants (`fast-check`)

| Invariant ID | Property | Generator |
|--------------|----------|-----------|
| INV-01 | If `decision === "book"`, both parties contain the full requested window in their local time | random dates, zones, rules |
| INV-02 | Every returned `slot.start` < `slot.end` | random schedules |
| INV-03 | Every returned slot falls within both parties' working hours (converted to a common absolute timeline) | random schedules |
| INV-04 | No returned slot falls on a blackout date for either party | random blackout dates |
| INV-05 | Slots are sorted ascending by start time | random availability |
| INV-06 | `slots.length` ≤ 3 | all inputs |
| INV-07 | Two calls with identical inputs (including `now`) produce identical output | deterministic |
| INV-08 | Shifting `now` across a DST boundary does not silently move a valid slot to an invalid local time | DST transition dates |
| INV-09 | An overnight window's end time may be less than its start time (wrap) and is handled without crash | random overnight intervals |
| INV-10 | Invalid zone string → structured error, never a crash | arbitrary strings |
| INV-11 | Generator oversamples DST transition days (spring-forward: 02:30 absent; fall-back: 01:30 twice) so edge cases are hit frequently | min/max random dates, random zone +5:30/+5:45/Sydney/Lord_Howe |
| INV-12 | Generator spans America/New_York's timezone with a fixed 15-minute step across a DST boundary | fixed-step random window |

---

## 4. CLI Snapshot Tests (`@tempo/cli`)

| Test ID | Command | Input | Snapshot Assertion |
|---------|---------|-------|-------------------|
| CLI-01 | `tempo check` | valid JSON, overlap | exit 0, JSON contains `decision: "book"` |
| CLI-02 | `tempo suggest` | valid JSON, no overlap | exit 1, JSON contains `decision: "counter_offer"`, `slots` array |
| CLI-03 | `tempo explain` | valid JSON | exit 0 or 1, stdout includes per-slot pass/fail reasons |
| CLI-04 | `tempo check` | malformed JSON | exit 2, structured error on stdout |
| CLI-05 | `tempo check` | `timeZone: "IST"` | exit 3, JSON error with `options` array |
| CLI-06 | `tempo check` | missing required fields | exit 2 |
| CLI-07 | `tempo --now 1700000000000 check` | valid JSON | uses injected `now`, deterministic output |
| CLI-08 | `tempo explain` | DST gap date | includes reason about nonexistent local time |

Snapshots stored under `packages/cli/__snapshots__/` and reviewed on change.

---

## 5. Edge-Case Catalogue

| Edge | Handling |
|------|----------|
| DST spring-forward gap (02:30 does not exist) | Clean rejection reason; never silently shift to 03:30 |
| DST fall-back ambiguity (01:30 occurs twice) | Luxon resolves to a valid offset; core documents which |
| Overnight window start day ownership | Window belongs to start day's ruleset; carryover documented |
| Blackout date = requested date | Full-day block; counter-offer on adjacent days |
| Split shifts with gap in middle | Request in gap → counter_offer |
| Zero mutual availability | `counter_offer`, `slots: []` |
| Ambiguous abbreviation IST | Exit 3, structured JSON with options |
| Invalid IANA zone | Exit 2 |
| Missing `now` in core call | Type error (TypeScript) / runtime validation error |
| `now` across DST boundary | Deterministic; no silent shifts |

---

## 6. Coverage Target

- 100% of `@tempo/core` public functions covered by unit or property tests.
- All CLI commands covered by snapshot tests.
- Branch coverage target ≥ 90% on `@tempo/core`; Stryker mutation testing threshold 70%.
- No test reads `Date.now()` directly; all time is injected or fixed.
