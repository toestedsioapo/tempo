# CLAUDE.md — Tempo

Tempo is a TypeScript library + CLI that decides whether a meeting request fits two parties' working hours (overnight shifts, DST, blackouts) and otherwise returns ranked counter-offers with reasons. It is **Project 1 of 4** in my GitHub Master Plan. Deskhand MCP, Deskbench and Deskflow all depend on it. Full plan: `PLAN.md`.

## Current phase

**PLANNING. Do not write implementation code or scaffold packages until I approve the docs.**
When I approve, I'll change this line to `IMPLEMENTATION — milestone N`.

## How we work (Superpowers)

- Use the Superpowers skills if installed: `brainstorming` → `writing-plans` → `test-driven-development` → `subagent-driven-development` / `executing-plans` → `requesting-code-review` → `verification-before-completion` → `finishing-a-development-branch`.
- If they aren't installed, follow the same discipline by hand: spec → plan → failing test → minimal code → refactor.
- **No production code without a failing test first.**
- **Flag every assumption.** Write it in `docs/ASSUMPTIONS.md` or ask me. Never choose silently.
- Ask at most 5 clarifying questions at a time, then wait.
- Keep changes small: one milestone task per branch/PR, Conventional Commits.

## Stack

TypeScript (strict, `noUncheckedIndexedAccess`), pnpm workspace, Luxon, Zod, Vitest + fast-check, GitHub Actions, MIT. Node `>=24` (CI tests 24 and 26). I develop on **Windows (PowerShell)**, so scripts must be cross-platform: no bash-only npm scripts, use `rimraf`/`cross-env` where needed.

## Layout

```
packages/core   pure engine (evaluate / suggest / explain, types, zod schemas)
packages/cli    thin CLI wrapper (args, io, exit codes, real clock)
schema/         GENERATED rules.schema.json — never hand-edit
skills/tempo/   SKILL.md for Claude Code
docs/           SPEC, ARCHITECTURE, adr/, TEST_PLAN, ROADMAP, ASSUMPTIONS
```

## Commands (planned; update once scaffolded)

```
pnpm install
pnpm build          # all packages
pnpm test           # vitest (unit + property)
pnpm test:watch
pnpm typecheck
pnpm lint
pnpm gen:schema     # zod -> schema/rules.schema.json
pnpm --filter cli dev -- explain --request examples/req.json --parties examples/parties.json
```

## Hard rules for `packages/core`

- **Pure.** No `Date.now()`, `new Date()`, `process.env`, `fs`, network or randomness. `now` arrives as an argument.
- Use Luxon `DateTime` with explicit zones everywhere. Never raw JS `Date` math.
- IANA zones only internally. Ambiguous abbreviations (IST, CST, BST…) return `needs_clarification` with candidates. **Never guess.**
- Overnight windows (`end < start`) wrap midnight. The owning weekday is defined in SPEC.md, so follow it exactly.
- DST nonexistent/ambiguous local times follow the ADR policy and always emit a `Reason`.
- Output must be deterministic, with stable sort and tie-breaks.
- Zod schemas are the single source of truth; types are `z.infer`'d; JSON Schema is generated.

## CLI contract

- JSON in (file or stdin), JSON out with `--json`. Human-readable output otherwise.
- Exit codes (pending approval): `0` book, `10` counter_offer, `11` needs_clarification, `2` invalid input, `1` internal.
- Exit codes and JSON output shape are **public API**. Changing them is a breaking change.

## Testing expectations

- Every worked example in SPEC.md has a table-driven test.
- Property invariants listed in TEST_PLAN.md live in `*.prop.test.ts`.
- DST fixtures cover US, EU, Australia/Lord_Howe and Asia/Manila (no DST), plus midnight wrap across a transition.
- CLI uses snapshot tests; update snapshots only intentionally and say why in the PR.
- Edge-case fixtures are exported for Deskbench. Keep them stable.

## Don'ts

- No secrets or tokens in the repo, ever.
- Don't add runtime dependencies beyond Luxon + Zod in core without an ADR.
- Don't edit generated files (`schema/`, `CHANGELOG.md` sections managed by changesets).
- Don't publish to npm locally; releases go through the GitHub Actions workflow with provenance.

## Downstream contract

`@<scope>/tempo-core` is imported by Deskhand MCP. Breaking API changes need a major bump, a CHANGELOG entry and a migration note.
