# PLAN — Tempo (Project 1 of 4)

> A TypeScript library + CLI that decides whether a meeting request fits two people's working hours (including overnight shifts and DST). If it doesn't fit, it returns ranked counter-offers with reasons.

**Timebox:** ~5–6 weeks · **Process:** Superpowers (spec-first, TDD, subagent-driven) · **Status:** Planning — no code until approved

---

## 1. Why this exists

Tempo turns the code step of my working n8n **Meeting Scheduler** into a tested, reusable engine:

- Today: Gemini extracts `{day, start, end, requester timezone}` from an email → a code node converts to both parties' local times → checks business-hours windows (one side works **8 p.m.–6 a.m.**, so the window wraps midnight) → books the slot or returns **three alternatives in the requester's local time**.
- Tempo makes that logic deterministic, property-tested, DST-correct and importable. It becomes the **scheduling brain** for Deskhand MCP (P2), Deskbench (P3) and Deskflow (P4).

## 2. Goals

1. **Pure, deterministic core.** `evaluate(request, parties, options) → { decision: "book" | "counter_offer" | "needs_clarification", reasons[], slots[] }`. No network, no clock, no fs, no env inside `core`. `now` is injected.
2. **Correct DST handling** with IANA zones, including **ambiguous** (fall-back) and **nonexistent** (spring-forward) local times, with an explicit, documented policy.
3. **Ambiguous abbreviations policy:** `IST`, `CST`, `BST`, etc. → *ask, don't guess* (`needs_clarification` with candidate zones).
4. **CLI:** `tempo check`, `tempo suggest`, `tempo explain`. JSON in/out, stable exit codes.
5. **Rules schema:** JSON Schema generated from Zod, published with the package.
6. **Agent-ready:** a bundled Claude Code `SKILL.md` so agents can drive the CLI.

## 3. Non-goals (v1)

- No calendar API access (that's Deskhand MCP).
- No natural-language parsing of emails (the caller/LLM extracts fields).
- No more than 2 parties in v1 (design the types so N-party is a later, non-breaking addition — **flag in ADR**).
- No recurring-meeting expansion.
- No GUI.

## 4. Domain model (draft — confirm in SPEC.md)

| Concept | Shape (sketch) |
|---|---|
| `MeetingRequest` | `{ date: "YYYY-MM-DD", start: "HH:mm", end: "HH:mm", zone: IANA \| abbreviation }` |
| `Party` | `{ id, zone: IANA, rules: WorkingRule[], blackouts: DateRange[] }` |
| `WorkingRule` | `{ weekdays: (1..7)[], start: "HH:mm", end: "HH:mm" }`. `end < start` means **overnight wrap** |
| `Options` | `{ now: ISO, horizonDays, slotStepMinutes, maxSuggestions (default 3), dstPolicy }` |
| `Result` | `{ decision, reasons: Reason[], slots: Slot[] }`, each `Slot` expressed in **requester zone + each party's zone + UTC** |
| `Reason` | machine code (`OUTSIDE_WINDOW`, `IN_BLACKOUT`, `DST_NONEXISTENT`, `DST_AMBIGUOUS`, `AMBIGUOUS_ZONE`, `IN_PAST` …) + human message |

**Key subtlety:** an overnight rule `Mon 20:00–06:00` belongs to the *Monday* shift but ends Tuesday morning. SPEC must define which weekday "owns" the shift.

## 5. Architecture (target)

```
tempo/
├─ packages/
│  ├─ core/        # pure engine: types, zod schemas, evaluate(), suggest(), explain()
│  └─ cli/         # thin wrapper: arg parsing, io, exit codes; injects real clock
├─ schema/         # generated rules.schema.json (do not hand-edit)
├─ skills/tempo/SKILL.md
├─ docs/ (SPEC.md, ARCHITECTURE.md, TEST_PLAN.md, ROADMAP.md, adr/)
└─ .github/workflows/ (ci.yml, release.yml)
```

### ADRs to write

1. **Luxon vs Temporal.** Luxon is the stated choice. Re-check Temporal's status in current Node LTS before locking (assumption: still not safe to rely on unflagged in all target runtimes).
2. **Zone-abbreviation policy.** Accept IANA always. Accept unambiguous abbreviations only from an allow-list. Anything else → `needs_clarification`.
3. **Injecting "now".** `now` is a required option in core; the CLI supplies `DateTime.now()`; tests supply fixed instants.
4. **DST policy.** Nonexistent local time → shift forward / reject (configurable, default reject with reason). Ambiguous → earlier offset by default + reason.
5. **Suggestion ranking.** For example: closest to the requested time, then earliest, then least "edge of window". Deterministic tie-breaks.

### Proposed CLI exit codes (flag for approval)

| Code | Meaning |
|---|---|
| 0 | `book` |
| 10 | `counter_offer` |
| 11 | `needs_clarification` |
| 2 | invalid input (schema error) |
| 1 | internal error |

## 6. Test strategy

- **Unit tests** from every worked example in SPEC.md (15+), table-driven.
- **Property-based (fast-check) invariants:**
  - `book` ⇒ the slot lies fully inside a window for **both** parties.
  - Every counter-offer slot independently passes `check`.
  - Duration of suggested slots == requested duration.
  - Determinism: same input + same `now` ⇒ identical output.
  - No slot overlaps a blackout or lies before `now`.
  - Slots are sorted by rank, unique, and ≤ `maxSuggestions`.
  - UTC ↔ local round-trip is lossless for valid instants.
  - Expressing the same request in a different but equivalent zone yields the same decision.
- **DST fixtures:** US (Mar/Nov), EU (Mar/Oct), Australia/Lord_Howe (30-min shift), zones without DST (Asia/Manila), midnight-wrap across a DST change.
- **CLI snapshot tests** for `check`, `suggest`, `explain` output and exit codes.
- Coverage target: core ≥ 95% lines/branches.

## 7. Milestones

| Week | Milestone | Definition of done |
|---|---|---|
| 0 | Planning docs | SPEC, ARCHITECTURE (+ADRs), TEST_PLAN, ROADMAP, README skeleton approved by me |
| 1 | Scaffold + types | pnpm workspace, strict TS, lint, Vitest, CI green; Zod schemas + generated JSON Schema; no logic yet |
| 2 | Core windows | Same-day + overnight-wrap + per-weekday + blackout evaluation; all non-DST worked examples pass |
| 3 | DST + suggest | DST policy implemented; fast-check invariants green; `suggest()` returns ranked slots in requester zone |
| 4 | CLI | `check` / `suggest` / `explain`, JSON io, exit codes, snapshot tests, `--help` docs |
| 5 | Agent + docs | `SKILL.md`, README with real `tempo explain` demo, example files that mirror the n8n flow, n8n Code-node snippet |
| 6 | Release | Changesets, CHANGELOG, `npm publish --provenance` from GitHub Actions, v0.1.0 tagged |

## 8. Ecosystem contract (what later projects rely on)

- `@marvinliem/tempo-core` public API: `evaluate`, `suggest`, `explain`, types, Zod schemas.
- **Semver strictly.** Deskhand pins a major version.
- The edge-case catalogue in TEST_PLAN.md is **exported as fixtures** (`@marvinliem/tempo-core/fixtures`). Deskbench seeds scenarios from it.

## 9. Risks & assumptions (flagged)

- ⚠️ **Package name:** `tempo` is almost certainly taken on npm → plan for a scoped name (`@marvinliem/tempo`, `@marvinliem/tempo-cli`). The binary can still be `tempo`.
- ⚠️ **Node version:** you have Node 24.x locally. Node 26 became Active LTS in Oct 2026. Decide: support `>=24` and test 24 + 26 in CI (recommended).
- ⚠️ Overnight-shift weekday ownership is a product decision. Ask before choosing.
- ⚠️ Assumes 2 parties and a single contiguous meeting.

## 10. Open questions for the kickoff session

1. Final npm scope / package names?
2. Which weekday owns an overnight shift (start day — recommended)?
3. Default DST policy for nonexistent times: reject or shift forward?
4. Suggestion horizon (e.g. next 7 days) and step (15 or 30 min)?
5. Should `explain` output be human text by default and JSON with `--json`, or the other way round?

## 11. Kickoff

Open this folder in Claude Code and paste the **Project 1 kickoff prompt** from the Master Plan PDF (page 2). This PLAN.md and CLAUDE.md give it the context; it should produce `docs/SPEC.md`, `docs/ARCHITECTURE.md`, `docs/TEST_PLAN.md`, `docs/ROADMAP.md` and `README.md`, then stop for approval.
