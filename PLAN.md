# PLAN — Tempo (Project 1 of 4)

> A TypeScript library + CLI that decides whether a meeting request fits everyone's working hours (two or more people, including overnight shifts and DST). If it doesn't fit, it returns ranked, non-overlapping counter-offers with reasons.

**Timebox:** ~6 weeks · **Process:** Superpowers (spec-first, TDD, subagent-driven) · **Status:** Planning approved (round 3) — implementation, milestone 1

> `DECISIONS.md` is the source of truth, then `SPEC.md`. This file is the overview; where it disagrees with them, it is wrong.

---

## 1. Why this exists

Tempo turns the code step of my working n8n **Meeting Scheduler** into a tested, reusable engine:

- Today: Gemini extracts `{day, start, end, requester timezone}` from an email → a code node converts to both parties' local times → checks business-hours windows (one side works **8 p.m.–6 a.m.**, so the window wraps midnight) → books the slot or returns **three alternatives in the requester's local time**.
- Tempo makes that logic deterministic, property-tested, DST-correct and importable. It becomes the **scheduling brain** for Deskhand MCP (P2), Deskbench (P3) and Deskflow (P4).

## 2. Goals

1. **Pure, deterministic core.** `evaluate({ request, participants, options })` returns `{ ok: true, decision: "book" | "counter_offer", requested, slots[], reasons[] }` or `{ ok: false, error }`. No network, no clock, no fs, no env inside `core`. `now` is injected. Core never throws.
2. **Correct DST handling** with IANA zones. A request time that is **nonexistent** (spring-forward) or **ambiguous** (fall-back) is rejected with an explicit error and details; availability-rule boundaries follow a documented policy and emit a reason.
3. **Ambiguous abbreviations policy:** `IST`, `CST`, `BST`, etc. → *ask, don't guess*: an `AMBIGUOUS_ZONE` error with the candidate zones (CLI exit 3).
4. **CLI:** `tempo check`, `tempo suggest`, `tempo explain`. JSON in/out, stable exit codes.
5. **Rules schema:** JSON Schema generated from Zod, published with the package.
6. **Agent-ready:** a bundled, tool-agnostic `SKILL.md` (at the repo root) so agents can drive the CLI.

## 3. Non-goals (v0.1.0)

- No calendar API access (that's Deskhand MCP).
- No natural-language parsing of emails (the caller/LLM extracts fields).
- No recurring-meeting expansion; a single contiguous meeting.
- No blackout date ranges (callers expand them) and no per-party minimum notice.
- No GUI.

(N participants, minimum 2, are **in** scope since D13.)

## 4. Domain model (normative version: SPEC §3)

| Concept | Shape (sketch) |
|---|---|
| `NegotiationRequest` | `{ request, participants: PartyRules[], options }` |
| `MeetingRequest` | `{ date: "YYYY-MM-DD", start: "HH:mm", end: "HH:mm", timeZone: IANA }`; `end < start` ends the next day; `end == start` is invalid |
| `PartyRules` | `{ partyId, timeZone: IANA, weeklyRules: { monday?: Interval[], … }, blackouts?: "YYYY-MM-DD"[] }` |
| `Interval` | `{ start: "HH:mm", end: "HH:mm" \| "24:00" }`. `end < start` means **overnight wrap**; `end == start` is invalid |
| `Options` | `{ now: UTC ISO string, minNoticeMinutes?, searchHorizonDays?, searchStepMinutes?, maxSuggestions? }` |
| `NegotiationResult` | `{ ok: true, decision, requested, slots: IsoSlot[], reasons: Reason[] }` or `{ ok: false, error: { code, message, details? } }` |
| `IsoSlot` | `{ start, end }` in the requester zone with numeric offset, plus `startUtc`, `endUtc` |
| `Reason` | `{ code, participantId?, message }`: `IN_PAST`, `INSUFFICIENT_NOTICE`, `OUTSIDE_AVAILABILITY`, `IN_BLACKOUT`, `NO_SLOTS_IN_HORIZON`, `DST_RULE_ADJUSTED` |

**Key subtlety (resolved, C5):** an overnight rule `Mon 20:00–06:00` is owned by the day it **starts**, Monday, though it ends Tuesday morning.

## 5. Architecture (target)

```
tempo/
├─ packages/
│  ├─ core/        # pure engine: types, zod schemas, evaluate(), suggest(), explain()
│  └─ cli/         # thin wrapper: arg parsing, io, exit codes; injects real clock
├─ schema/         # generated rules.schema.json (do not hand-edit)
├─ SKILL.md        # tool-agnostic agent skill (D16)
├─ docs/plans/     # milestone plans
├─ SPEC.md, ARCHITECTURE.md, TEST_PLAN.md, ROADMAP.md, DECISIONS.md, ASSUMPTIONS.md
└─ .github/workflows/ (ci.yml, release.yml)
```

### ADRs (written in `ARCHITECTURE.md`)

1. **Luxon vs Temporal.** Luxon (C12).
2. **Zone-abbreviation policy.** Accept IANA always, plus `UTC` and `GMT`. Abbreviations in the SPEC §7 table → `AMBIGUOUS_ZONE`; anything else unknown → `INVALID_ZONE`.
3. **Injecting "now".** `now` is a required option in core (ISO-8601 UTC string); the CLI supplies the real clock; tests supply fixed instants.
4. **DST policy.** Nonexistent **and** ambiguous request times are rejected with explicit codes (C10). Rule boundaries: gap → forward, overlap → earlier occurrence, with `DST_RULE_ADJUSTED` (G28).
5. **Interval algebra and ranking.** Absolute-distance ranking from the requested start on a 15-minute lattice, ties → earlier, then greedy selection that skips overlapping candidates (C9, G22).

### Exit codes (D14, G24)

| Code | Meaning |
|---|---|
| 0 | the computation succeeded (`book` or `counter_offer`) |
| 1 | only with `--exit-code`: the decision is `counter_offer` |
| 2 | input error (invalid input, zone, interval, DST request time) |
| 3 | ambiguous zone abbreviation |
| 4 | internal error |

## 6. Test strategy

- **Unit tests** from every worked example in SPEC.md (24), table-driven.
- **Property-based (fast-check) invariants** (INV-01 … INV-14 in `TEST_PLAN.md`), including:
  - `book` ⇒ the slot lies fully inside availability for **every** participant.
  - Every counter-offer slot independently passes `check`.
  - Duration of suggested slots == requested duration; no two suggestions overlap.
  - Determinism: same input + same `now` ⇒ identical output.
  - No slot overlaps a blackout or lies before `now`.
  - Slots are in rank order, unique, and ≤ `maxSuggestions`.
  - UTC ↔ local round-trip is lossless for valid instants.
  - Expressing the same request in a different but equivalent zone yields the same decision.
- **Independent oracle:** a minute-by-minute UTC reference model checks `evaluate` differentially.
- **DST fixtures:** US (Mar/Nov), EU (Mar/Oct), Australia/Sydney, Australia/Lord_Howe (30-min shift), zones without DST (Asia/Manila), midnight-wrap across a DST change.
- **CLI snapshot tests** for `check`, `suggest`, `explain` output and exit codes.
- Coverage target: core ≥ 95% lines/branches; Stryker mutation threshold (A-23).

## 7. Milestones (detail: `ROADMAP.md`)

| Milestone | Week | Theme |
|---|---|---|
| M0 | 0 | Planning docs approved (done, round 3) |
| M1 | 1 | Clean restart, scaffold, schemas, CI |
| M2a | 2 | Interval algebra, decision, oracle |
| M2b | 3 | DST, slot search, `suggest`, `explain`, properties |
| M3 | 4 | CLI and exit codes |
| M4 | 5 | JSON Schema, `SKILL.md`, examples, README demo |
| M5 | 6 (first half) | Hardening and documentation review |
| M6 | 6 (second half) | Release `v0.1.0` (npm, provenance, from GitHub Actions) |

## 8. Ecosystem contract (what later projects rely on)

- `@marvinliem/tempo-core` public API: `evaluate`, `suggest`, `explain`, types, Zod schemas.
- **Semver strictly** (see ARCHITECTURE §6 for the `0.x` rule). Deskhand pins a major version.
- The edge-case catalogue in `TEST_PLAN.md` is **exported as fixtures** (`@marvinliem/tempo-core/fixtures`). Deskbench seeds scenarios from it.

## 9. Risks & assumptions

- ⚠️ **Package names:** `@marvinliem/tempo-core` and `@marvinliem/tempo` must be available on npm. M1 has a name gate (`pnpm check:names`); if it fails, stop and ask.
- Node: `engines.node >=24`; CI tests 24 and 26 on ubuntu and windows (G29).
- Everything else the docs don't settle is an `A-nn` row in `ASSUMPTIONS.md`.

## 10. Questions from the kickoff, now answered

| Question | Answer |
|---|---|
| npm scope / names | `@marvinliem/tempo-core`, `@marvinliem/tempo` (binary `tempo`) — subject to the M1 name gate |
| Which weekday owns an overnight shift | the day it starts (C5) |
| DST default for nonexistent times | reject with an error (C10); ambiguous times are rejected too |
| Horizon and step | 14 days, 15 minutes (C9) |
| `explain` output | human text by default, JSON with `--json` (SPEC §5) |

## 11. Status

Planning is approved (round 3, `DECISIONS.md` G22–G29). Work proceeds by milestone from `docs/plans/`; milestone 1 plan: `docs/plans/M1.md`.
