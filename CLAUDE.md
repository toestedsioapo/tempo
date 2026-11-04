# CLAUDE.md — Tempo

Tempo is a TypeScript library + CLI that decides whether a meeting request fits every participant's working hours (two or more people; overnight shifts, DST, blackouts) and otherwise returns ranked, non-overlapping counter-offers with reasons. It is **Project 1 of 4** in my GitHub Master Plan. Deskhand MCP, Deskbench and Deskflow all depend on it. Full plan: `PLAN.md`.

## Current phase

**IMPLEMENTATION — milestone 2b complete locally (awaiting push gate); next is milestone 3 (CLI).**
Milestone plans live in `docs/plans/`. Do not start executing a plan until I say "go".

## Source of truth

`DECISIONS.md` wins over everything. Then `SPEC.md` (behaviour, 24 worked examples), then `ARCHITECTURE.md`, `TEST_PLAN.md`, `ROADMAP.md`. Every choice those don't settle is an `A-nn` row in `ASSUMPTIONS.md`. The planning docs sit at the repo root for now (A-30).

## Project Guidelines

### How we work (Superpowers)

- Use the Superpowers skills if installed: `brainstorming` → `writing-plans` → `test-driven-development` → `subagent-driven-development` / `executing-plans` → `requesting-code-review` → `verification-before-completion` → `finishing-a-development-branch`.
- If they aren't installed, follow the same discipline by hand: spec → plan → failing test → minimal code → refactor.
- **No production code without a failing test first.**
- **Flag every assumption.** Write it in `ASSUMPTIONS.md` or ask me. Never choose silently.
- Ask at most 5 clarifying questions at a time, then wait.
- Keep changes small: one milestone task per branch/PR, Conventional Commits.

## Stack

TypeScript (strict, `noUncheckedIndexedAccess`), pnpm workspace (pnpm 12), Luxon, Zod, Vitest + fast-check, GitHub Actions, MIT. Node `>=24` (CI tests 24 and 26). I develop on **Windows (PowerShell)**, so scripts must be cross-platform: no bash-only npm scripts, use `rimraf`/`cross-env` where needed.

## Layout

```
packages/core   pure engine (evaluate / suggest / explain, types, zod schemas)   @marvinliem/tempo-core
packages/cli    thin CLI wrapper (args, io, exit codes, real clock)              @marvinliem/tempo (bin: tempo)
schema/         GENERATED rules.schema.json — never hand-edit
SKILL.md        tool-agnostic skill for agents, at the repo root (D16)
docs/plans/     milestone plans (M1.md, …)
*.md            SPEC, ARCHITECTURE, TEST_PLAN, ROADMAP, DECISIONS, ASSUMPTIONS at the repo root (A-30)
```

## Build command

```
pnpm install
pnpm build          # all packages
pnpm gen:schema     # zod -> schema/rules.schema.json
pnpm check:names    # npm name gate (read-only GET to the registry)
```

## Test command

```
pnpm test           # vitest (unit + property)
pnpm test:watch
pnpm test:coverage  # v8 coverage report, no threshold in M1 (A-41)
pnpm typecheck
pnpm lint
```

## Hard rules for `packages/core`

- **Pure.** No `Date.now()`, `new Date()`, `process.env`, `fs`, network or randomness. `now` arrives as an argument.
- **Errors are values (D13).** Core never throws; it returns `{ ok: true, … }` or `{ ok: false, error }`.
- Use Luxon `DateTime` with explicit zones everywhere. Never raw JS `Date` math.
- IANA zones only internally. Ambiguous abbreviations (IST, CST, BST…) return an `AMBIGUOUS_ZONE` error listing the candidate zones (CLI exit 3). **Never guess.** There is no `needs_clarification` decision (G26).
- Overnight windows (`end < start`) wrap midnight. The owning weekday is the day the interval **starts** (SPEC §4.3); follow it exactly. A request with `start == end` is `INVALID_INPUT` (G23).
- A request time that is nonexistent or ambiguous because of DST is an error (`DST_NONEXISTENT_LOCAL_TIME` / `DST_AMBIGUOUS_LOCAL_TIME`, exit 2). Availability-rule boundaries follow the A-07 policy and emit `DST_RULE_ADJUSTED` (ADR 4).
- Output must be deterministic, with stable sort and tie-breaks. Counter-offer slots never overlap one another (G22).
- Zod schemas are the single source of truth; types are `z.infer`'d; JSON Schema is generated.

## CLI contract

- JSON in (file or stdin), JSON out with `--json`. Human-readable output otherwise. Commands: `tempo check | suggest | explain [file]` (SPEC §5).
- Exit codes: `0` computation succeeded (whatever the decision); `1` only with `--exit-code` and the decision is `counter_offer`; `2` input error; `3` ambiguous zone; `4` internal error.
- Exit codes and JSON output shape are **public API**. Changing them is a breaking change.

## Testing expectations

- Every worked example in SPEC.md has a table-driven test.
- Property invariants listed in TEST_PLAN.md live in `*.prop.test.ts`.
- DST fixtures cover US, EU, Australia/Sydney, Australia/Lord_Howe and Asia/Manila (no DST), plus midnight wrap across a transition.
- CLI uses snapshot tests; update snapshots only intentionally and say why in the PR.
- Edge-case fixtures are exported for Deskbench. Keep them stable.

## Don'ts

- No secrets or tokens in the repo, ever.
- Don't add runtime dependencies beyond Luxon + Zod in core without an ADR.
- Don't edit generated files (`schema/`, `CHANGELOG.md` sections managed by changesets).
- Don't publish to npm locally; releases go through the GitHub Actions workflow with provenance.

## Downstream contract

`@marvinliem/tempo-core` is imported by Deskhand MCP. Breaking API changes need a major bump, a CHANGELOG entry and a migration note (while on `0.x`, ARCHITECTURE §6 applies).
