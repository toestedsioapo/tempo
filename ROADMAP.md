# Tempo — ROADMAP.md

> **Status:** Draft (planning only — no implementation code)
> **Mode:** Plan-mode deliverable. Review and approve before any scaffolding or code.

---

## Overview

Six weekly milestones, ending in an npm release with provenance. Each milestone has a definition of done (DoD). Work is spec-first and test-first: tests are written before implementation within each milestone.

---

## Milestone 1 — Foundation & Core Types (Week 1)

**Goal:** Scaffold the pnpm workspace, define shared types and Zod schemas, set up CI, and add an npm-scope availability gate.

**Scope:**
- Root `package.json` (private, workspaces: `packages/*`, `npm-scope` gate in package.json)
- `pnpm-workspace.yaml`
- `packages/core` scaffold: `@tempo/core`, TypeScript strict, Luxon, Zod, Vitest
- `packages/cli` scaffold: `@tempo/cli`, binary `tempo`, depends on `@tempo/core`
- Public types (`types.ts`), request/response Zod schemas (`schema.ts`)
- GitHub Actions CI: install, typecheck, lint, test
- MIT license
- `.npmrc` provenance config (no secrets)
- `changesets` configured for versioning
- npm-scope availability gate: root `package.json` `publishConfig` restricted to ` Tempo/*` scope

**Definition of Done:**
- `pnpm install` works
- `pnpm test` passes (empty suite green)
- `pnpm run typecheck` passes
- CI runs on push/PR and is green
- `packages/core` exports types and schemas; `packages/cli` has a `tempo` binary stub

---

## Milestone 2 — Pure Core Negotiation (Week 2)

Split into two sub-milestones:

### Milestone 2a — Interval Algebra, Decision & Oracle (Week 2a)

**Goal:** Implement and test the deterministic interval algebra and decision logic.

**Scope:**
- `negotiate(request): NegotiationResult` — pure, `now` injected
- Working-hours evaluation: per-day intervals, overnight wrap, split shifts
- Blackout date (full-day) checks
- DST handling: nonexistent and ambiguous local times mapped to clean rejection
- Unit tests (CORE-01…CORE-16) + property invariants (INV-01…INV-10)

**Definition of Done (2a):**
- All core unit tests pass
- All property-based invariants pass
- 100% coverage of core public functions
- No `Date.now()` or clock access inside core
- SPEC.md worked examples verified against unit tests
- Brute-force UTC oracle matches `negotiate()` output on all example inputs

**Definition of Done (2b):**
- Slots ≤ 3, sorted ascending by start time
- No returned slot falls on a blackout date
- Counter-offer slots ranked by distance, ties earlier first
- All SPEC.md examples verified against unit tests

### Milestone 2b — Slot Search & DST (Week 2b)

**Goal:** Implement and test alternative-slot generation and counter-offer search.

**Scope:**
- Slot generation: up to 3 absolute ISO-8601 slots with offsets
- Counter-offer search: `searchHorizonDays` default 14, 15-minute step, same duration as request, up to 3 slots ranked by absolute distance from requested start (ties: earlier first)
- DST: deterministic slot search across transition boundaries
- Unit tests for counter-offer ranking
- End-to-end verification of all SPEC.md Section 5 examples

**Definition of Done:**
- Slots ≤ 3, sorted ascending by start time
- No returned slot falls on a blackout date
- Counter-offer slots ranked by distance, ties earlier first
- All SPEC.md examples verified against unit tests

---

## Milestone 3 — CLI Commands & Exit Codes (Week 3)

**Goal:** Implement `tempo check`, `tempo suggest`, `tempo explain` with JSON in/out and stable exit codes.

**Scope:**
- CLI argument parsing and JSON input (file or stdin)
- Zone validation: IANA accepted; ambiguous abbreviations → exit 3 with structured JSON
- `now` injection: `DateTime.now().toMillis()` at CLI boundary; `--now` override flag
- Exit codes: 0 = book, 1 = counter_offer, 2 = input error, 3 = ambiguous timezone
- `tempo explain` prints per-slot pass/fail reasons
- CLI snapshot tests (CLI-01…CLI-08)

**Definition of Done:**
- All three commands produce correct exit codes and JSON output
- All CLI snapshot tests pass
- `tempo explain` output is stable and snapshot-locked
- No interactive TTY prompts anywhere

---

## Milestone 4 — Rules Schema & SKILL.md (Week 4)

**Goal:** Ship machine-readable rules schema and agent-facing documentation.

**Scope:**
- JSON Schema generated from Zod (`getRulesJsonSchema()` exported from `@tempo/core`)
- `SKILL.md` at repo root: how Claude Code / agents drive the CLI via pipes
- Example rule files (JSON) for common scenarios (overnight shift, DST zones, blackouts)
- README skeleton with mocked `tempo explain` demo

**Definition of Done:**
- `getRulesJsonSchema()` returns valid JSON Schema
- `SKILL.md` includes example invocations and expected exit codes
- Example rule files validate against the schema
- README skeleton reviewed

---

## Milestone 5 — Polish, Edge Cases & Docs (Week 5)

**Goal:** Harden DST edge cases, complete documentation, and review spec coverage.

**Scope:**
- Additional DST edge-case tests (spring-forward gap, fall-back ambiguity, overnight crossing DST)
- SPEC.md 15+ worked examples all mapped to passing tests
- TEST_PLAN.md edge-case catalogue fully covered
- ARCHITECTURE.md ADRs reviewed and signed off
- README finalized (pitch, why, install, mocked demo)

**Definition of Done:**
- All edge-case tests pass
- All 5 planning documents (SPEC, ARCHITECTURE, TEST_PLAN, ROADMAP, README) consistent with code
- No secrets in repo
- All TODO items in planning documents resolved
- Documentation reviews signed off by designated reviewer

---

## Milestone 6 — Release with Provenance (Week 6)

**Goal:** Publish `@tempo/core` and `@tempo/cli` to npm with GitHub Actions provenance.

**Scope:**
- Build step (TypeScript compile) for both packages
- npm provenance mapping to GitHub Actions workflow runner
- Publisher token configured via GitHub OIDC (no secrets in repo)
- `npm publish` for `@tempo/core` and `@tempo/cli`
- Tag release `v1.0.0`
- Post-release: verify packages installable and `tempo` binary works

**Definition of Done:**
- `npm view @tempo/core` and `npm view @tempo/cli` return published packages
- npm provenance visible on published packages (GitHub Actions runner)
- GitHub release tag `v1.0.0` created
- `npx @tempo/cli` (or `tempo` after global install) runs end-to-end
- Roadmap complete; await stakeholder approval for next project (MCP server)
