# Tempo — ROADMAP.md

> **Status:** APPROVED (planning round 3). `CLAUDE.md` says `IMPLEMENTATION — milestone 1`; each milestone is executed from its own plan in `docs/plans/` only after I say “go”.
> **Precedence:** `DECISIONS.md` is the source of truth. Assumptions: `A-nn` in [`ASSUMPTIONS.md`](./ASSUMPTIONS.md). Test IDs: [`TEST_PLAN.md`](./TEST_PLAN.md).

## Overview

Six milestones over about six weeks, ending in the **first release, `v0.1.0`** of two packages published to npm with provenance from GitHub Actions: `@marvinliem/tempo-core` (library) and `@marvinliem/tempo` (CLI, binary `tempo`).

| Milestone | Week | Theme |
|---|---|---|
| M0 | 0 | Planning docs approved (this set) |
| M1 | 1 | Clean restart, scaffold, schemas, CI |
| M2a | 2 | Interval algebra, decision, oracle |
| M2b | 3 | DST, slot search, `suggest`, `explain`, properties |
| M3 | 4 | CLI and exit codes |
| M4 | 5 | JSON Schema, `SKILL.md`, examples, README demo |
| M5 | 6 (first half) | Hardening and documentation review |
| M6 | 6 (second half) | Release `v0.1.0` |

**How every task is done** (applies to all milestones):

* One milestone task per branch and PR; Conventional Commits; PR description lists the tests added.
* Superpowers flow: `brainstorming` → `writing-plans` → `test-driven-development` → `subagent-driven-development` / `executing-plans` → `requesting-code-review` → `verification-before-completion` → `finishing-a-development-branch`. (If a skill is not installed, follow the same discipline by hand.)
* **A failing test first**, then minimal code, then refactor.
* Anything not decided in `DECISIONS.md` is written to `ASSUMPTIONS.md` or asked, never chosen silently.
* CI (the full 24/26 × ubuntu/windows matrix) must be green before merge.

---

## M1 — Clean restart and foundation (Week 1)

**Goal:** a green, empty, correctly configured monorepo with the schemas test-first and the npm names confirmed. No engine logic.

**Scope**

1. **Delete `packages/*/src`.** That code was written before approval and does not build; it is not repaired. It stays in git history at `5f8ae8c`. Also review the stray root files `verify_types.ts` and `tsconfig.verify.json`.
2. **Name gate (F20):** `pnpm check:names` verifies that `@marvinliem/tempo-core` and `@marvinliem/tempo` are available (or owned) on npm. If not, stop and ask for new names before going further.
3. **Root configuration** replacing the current one: `package.json` (private; version reset, A-20; `packageManager: pnpm@12.15.x`, G29; `engines.node >=24`; scripts `build`, `typecheck`, `lint`, `test`, `test:watch`, `gen:schema`, `check:names`, all cross-platform with `rimraf`/`cross-env`). Note the current root `test` script passes `--passWithNoTests` to pnpm, which is wrong: that flag goes on the `vitest run` call inside each package script until real tests exist. `pnpm-workspace.yaml` with `packages: ['packages/*']`. Shared `tsconfig` (strict, `noUncheckedIndexedAccess`, ESM, `NodeNext`). ESLint including the purity rules. changesets. MIT licence. `.npmrc` (`engine-strict=true`, no secrets).
4. **Package scaffolds:** `@marvinliem/tempo-core` and `@marvinliem/tempo` (bin `tempo`), both `0.1.0`, ESM with `exports`.
5. **Types and Zod schemas, test-first:** CORE-01 … CORE-07, CORE-41 and CORE-42 (request `start == end`, G23); `pnpm gen:schema` produces `schema/rules.schema.json`; Zod major version chosen here (A-22).
6. **CI workflow:** Node 24 and 26 × ubuntu-latest and windows-latest; frozen-lockfile install, typecheck, lint, test, build.
7. **Repo checks:** CFG-01 … CFG-08, CFG-10, CFG-11 (CFG-09 comes with `SKILL.md`).
8. Housekeeping from A-19: decide whether planning docs move into `docs/` (ADRs stay inside ARCHITECTURE.md unless asked). **Decided (A-30): the planning docs stay at the repo root; only `docs/plans/` is new.**

**Definition of done**

- [x] `pnpm install --frozen-lockfile` works on Linux and Windows. Windows proved by a fresh clone of the branch HEAD (Windows, pnpm 12.15.0, Node 24): `pnpm install --frozen-lockfile` exit 0. Linux proved by CI run 41652211022 on `main` (`verify (ubuntu-latest, 24)` and `(ubuntu-latest, 26)` passed the `pnpm install --frozen-lockfile` step), 2026-11-03.
- [x] `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build` pass; `pnpm test` runs the schema and repo tests, not an empty suite. Proved on a fresh clone of the branch HEAD (Windows, pnpm 12.15.0, Node 24): `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, `pnpm gen:schema` (followed by an empty `git status --short`) and `pnpm check:names` all exited 0. `pnpm test` ran 159 tests at the Task 12 verification (repo 24 passed + 2 todo, core 126, cli 9); the later final-review lint fix added 9 core purity tests, so core is now 135 and the total 168.
- [x] CI green on all four matrix jobs. Proved by `gh run view 41652211022` on `main` (merge commit d15d968): `verify` passed on ubuntu-latest and windows-latest, each with Node 24 and 26, and the coverage artifact uploaded for each.
- [x] `packages/*/src` contains only the new test-first schema/type code; the old files are gone. Proved by `git ls-files packages` (only `core/src/{index,issues,parse,schema,types}.ts` with tests, and `cli/src/exit-codes.ts`) and the absence of `verify_types.ts` and `tsconfig.verify.json` at the root.
- [x] `pnpm gen:schema` is reproducible (CORE-41); `schema/rules.schema.json` is generated, never hand-edited. Proved by `pnpm gen:schema` followed by an empty `git status --short`, and by `packages/core/test/schema-drift.test.ts` inside `pnpm test`.
- [x] `pnpm check:names` passed (or new names agreed). Proved by `pnpm check:names` (exit 0, both names available), also covered by `tests/check-names.test.ts` for the logic.
- [x] `CLAUDE.md` “Build command” and “Test command” sections match reality. Proved by `CLAUDE.md` (lists `pnpm gen:schema`, `pnpm check:names`, `pnpm test:coverage`, all defined in the root `package.json` scripts).

---

## M2a — Interval algebra, decision and oracle (Week 2)

**Goal:** a correct book / counter-offer **decision** with reasons, for non-search cases, cross-checked by an independent oracle.

**Scope**

* Zone validation before Luxon with the SPEC §7 table (C11): CORE-08 … CORE-11.
* Availability instances, overnight wrap with start-day ownership, `24:00`, `start == end` rejection (C5); blackouts in the party’s zone (C6); merge; closed containment: CORE-12 … CORE-21.
* Request interval incl. `end < start` ⇒ next day (C7); `start == end` is already rejected by the M1 schema (G23); time gates `IN_PAST`, `INSUFFICIENT_NOTICE` (C8): CORE-22, CORE-23.
* `evaluate()` returning the decision and reasons. For a `counter_offer`, `slots` is not computed yet; the examples that need ranked slots are marked `todo` until M2b.
* Oracle ORC-01 (decision only) and ORC-02.
* Worked examples fully passing in M2a: **EX-01, EX-03, EX-05, EX-07, EX-08, EX-09, EX-10, EX-14, EX-15, EX-16, EX-23**. Decision-and-reason assertions only for the rest.

**Definition of done**

- [x] All listed CORE tests, examples and ORC-02 pass. Proved on a fresh clone of branch `m2a/t08-closeout` (Windows, pnpm 12.15.0, Node 24; code commit 2edf55a): `pnpm test` exit 0 (repo 25 passed + 2 todo, core 358 passed + 4 todo, cli 9 passed). Re-verified on local `main` after the final-review fix wave (3f648cc, Windows, Node 24): `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm test`, `pnpm test:coverage` all exit 0; repo 25 passed + 2 todo, core 364 passed + 6 todo, cli 9 passed. The 4 core todos are the M2b examples EX-12, EX-13, EX-22, EX-24 (A-53); the other 2 are the DST-gap request-time inputs awaiting C10.
- [x] ORC-01 agrees with `evaluate` on the decision and the failing participants for the generated inputs of G-03/G-04 (small horizon). Proved by `packages/core/test/oracle/` inside `pnpm test` (exit 0, as above).
- [x] Core purity check CORE-40 passes (no `Date.now`, no raw `Date`, no `process`, no `fs`). Proved by `packages/core/test/purity.test.ts` (source scan plus lint-rule tests) inside `pnpm test`, and `pnpm lint` exit 0.
- [x] 95%+ line and branch coverage on the files added in this milestone. Proved by `pnpm test:coverage` exit 0 on the fresh clone, with the gate in `packages/core/vitest.config.ts` (A-58): core 100% lines (106/106) and 100% branches (81/81) at 3f648cc (105/105 and 79/79 at the first fresh clone) over `zones`, `intervals`, `render`, `reasons`, `gates`, `evaluate`.
- [x] `ASSUMPTIONS.md` updated for anything newly decided. A-50 … A-60 added.
- [x] CI green on the four matrix jobs for M2a. Proved by GitHub Actions run 41702963959 on `main` at 685cef9 (pushed 2026-11-03): `verify` succeeded on ubuntu-latest and windows-latest, each on Node 24 and Node 26 (4/4). Fresh-clone exit codes, all 0: `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:coverage`, `pnpm build`, `pnpm gen:schema` (followed by an empty `git status --short`).

---

## M2b — DST, slot search, `suggest`, `explain` (Week 3)

**Goal:** the complete core.

**Scope**

* Wall-time classification and the C10 rejection with exact `details`: CORE-35 … CORE-39 (US, EU, Sydney, Lord_Howe, Manila).
* Rule-boundary policy and `DST_RULE_ADJUSTED` (A-07): CORE-38.
* Counter-offer search on the lattice, ranking, tie-break, greedy non-overlapping selection (G22), `NO_SLOTS_IN_HORIZON` (C9): CORE-24 … CORE-34, CORE-43.
* `suggest()` and `explain()` (D15).
* All property invariants INV-01 … INV-14 with the generators G-01 … G-05 (E18); the full differential oracle ORC-01 incl. slots.
* **All 24 worked examples pass** with byte-exact output.

**Definition of done**

- [x] EX-01 … EX-24 pass; DOC-02 confirms SPEC.md and fixtures agree. Proved: `examples.test.ts` runs all 24 in the exact tier (the decision tier is deleted; EX-22 goes through `explain`), `fixtures-drift.test.ts` regenerates all 24 from SPEC §6 and compares byte for byte.
- [x] INV-01 … INV-14 green at 200 runs on PR; a 5,000-run nightly job is configured. Proved: `test/invariants.prop.test.ts` at the default 200; one local pass with `TEMPO_PROP_RUNS=5000` (about 51 min) found INV-03's A-67 restatability limit, fixed and pinned (seed -551987296), then INV-03 and the regression re-ran green at 5,000 and the rest of both property files passed at 5,000. The review then strengthened INV-08, INV-09, INV-10 and INV-12; those four ran green at 1,000 (not 5,000) before the merge, and the first nightly run exercised them at 5,000. `.github/workflows/nightly.yml` (cron `0 3 * * *` + `workflow_dispatch`, `TEMPO_PROP_RUNS: "5000"`) is pinned by `test/nightly-workflow.test.ts`. First run on GitHub: `gh workflow run nightly.yml` (workflow_dispatch), run 41816908957, `TEMPO_PROP_RUNS=5000`, job `properties` green on `main` at 53a1f10, so INV-01 … INV-14 and ORC-01 passed at 5,000 runs on CI.
- [x] ORC-01 agrees with `evaluate` on decisions **and** ranked slots. Proved: `test/oracle/differential.prop.test.ts` compares decision, failing parties, gate, exact ranked slots (`evaluate` on a counter_offer, `suggest` always) and the C10 request-time errors, with DST-weighted generators plus a directed DST generator; ORC-02 covers all 24 examples including EX-24 and slots. Mutation checks on `search.ts` (touching slots dropped, later-first tie-break, exclusive horizon) are all caught.
- [x] Output is deterministic (INV-06) and participant-order independent (INV-07). Proved: `test/invariants.prop.test.ts` for `evaluate`, `suggest` and `explain`.
- [x] Core coverage ≥ 95% line and branch (QG-01). Proved on a fresh clone of `m2b/t07-closeout` (code commit 0d2489c; Windows, pnpm 12.15.0, Node 24.11.1): `pnpm test:coverage` exit 0, core 100 % statements, 100 % lines, 99.39 % branches (165/166, `parse.ts:30`) over **all** of core (A-70 for the include list).
- [x] Every ErrorCode and ReasonCode in SPEC §3 is produced by at least one test. Proved: `test/codes.test.ts` (`INTERNAL_ERROR` via the mocked search path; `OK` is explain-only).
- [x] Fresh-clone run (same clone, Windows, Node 24.11.1, pnpm 12.15.0): `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm lint`, `pnpm test` (repo 26 passed + 1 todo, core 593 passed, cli 9 passed), `pnpm test:coverage`, `pnpm build` and `pnpm gen:schema` all exit 0, and `git status --short` is empty afterwards. The one repo todo is SKILL.md (M4). Search timing: `searchHorizonDays 90, searchStepMinutes 1, maxSuggestions 10` on a two-party request takes about 24 ms.
- [x] Re-verified on local `main` after the last two merges (65e5e5e, Windows, Node 24.11.1): `pnpm typecheck`, `pnpm lint`, `pnpm test` (core 595 passed), `pnpm build` exit 0. Flakiness found and fixed after the fresh-clone run: six parallel full-suite runs showed 5 s timeouts and a leaked mock (A-71, `testTimeout` 30 s), and one loaded run exposed a generator that emitted `00:00-00:00` on a 23-hour spring-forward day (A-72; an engine `INVALID_INTERVAL`, not an engine bug). Six further loaded runs and a 2,000-run property pass were green afterwards. **Not explained:** one early `pnpm test` on `main` failed INV-02 and INV-04 at 200 runs, but its output was filtered and the seed was lost; 3 idle full runs, a 1,500-run and a 6,000-run pass of those two properties, 6,000 engine-error hunts and the differential at 6,000 never reproduced it. It may have been the A-72 generator flaw (INV-04 hit it later), but that is a guess; CI logs now keep the seed, so the next occurrence is diagnosable.
- [x] CI green on all 4 matrix jobs (ubuntu/windows × Node 24/26) after the push. Proved: `gh run view 41816260416` on `main` at 53a1f10, conclusion success, jobs verify (ubuntu-latest, 24), (ubuntu-latest, 26), (windows-latest, 24), (windows-latest, 26) all success.

**Notes carried from M2a review**

- `dst.ts` needs a classifier that returns the 0/1/2 candidate instants plus the offsets before and after the transition; `wallTimeToMs` returns one number, and the C10 error details need more. ARCHITECTURE.md:43 puts wall-time to instant in `dst.ts`, while it lives in `intervals.ts` today.
- Decide what a rule whose start is pushed past its end by a DST gap means (for example 02:30-03:00 on a spring-forward day becomes negative, [07:30Z, 07:00Z]); SPEC is silent. **Resolved by G34:** a gap boundary resolves to the transition instant, and a rule wholly inside the gap is dropped (Task 3).
- Add a direct `intervals` test where the party's local date differs from the UTC date for a blackout (Manila 07:00 is 23:00Z the previous day).
- Lowercase `utc`/`gmt` request zones render `Z` (settled in the M2a fix wave, A-60).
- Do not release between M2a and M2b: `evaluate` is public, and until C10 lands DST-gap request times are accepted (A-53). **Resolved by M2b Task 1.** `suggest` and `explain` are new public API: the version to release is the owner's call (not decided here).

---

## M3 — CLI commands and exit codes (Week 4)

**Goal:** `tempo check`, `tempo suggest`, `tempo explain` with JSON in/out and the exit codes of **D14**.

**Scope**

* Argument parsing; input from file, stdin or `-`; UTF-8 with BOM stripped (CLI-11, CLI-12).
* `--json`, `--exit-code`, `--now <ISO>`, `--help`, `--version`; `--now` > `options.now` > the real clock, which only `clock.ts` reads (CLI-10).
* **Exit codes (D14):** `0` whenever the computation succeeds; with `--exit-code`, `counter_offer` → `1` (and `book` → `0`); `2` input error (including DST errors); `3` ambiguous zone; `4` internal error (G24). *This replaces the earlier M3 text “0 = book, 1 = counter_offer, 2 = input error, 3 = ambiguous timezone”, which contradicted D14.*
* Human-readable output by default; JSON shapes exactly as in the SPEC (CLI-01 … CLI-19).
* Never prompts on a TTY (CLI-13).

**Definition of done**

- [x] CLI-01 … CLI-18 pass on Linux and Windows jobs. **CI run 41881826640 on fbc4241: all four jobs green (ubuntu/windows x Node 24/26).** Local proof so far (Windows, Node 24.11.1, pnpm 12.15.0): `packages/cli` has 11 test files and 202 tests, all passing; CLI-01 … CLI-17 through `main` with a fake `Env` (`src/main.test.ts`, `src/render.test.ts`, `src/args.test.ts`, `src/now.test.ts`, `src/clock.test.ts`, `test/clock-purity.test.ts`), CLI-18 and CLI-13/CLI-11 through a real spawned process (`test/bin.test.ts`, 13 tests, with a path containing spaces and non-ASCII characters, CRLF, UTF-8 BOM and UTF-16LE BOM files, a closed stdout and no-input exits).
- [x] Every `CLI exit code` line in SPEC §6 is asserted by a test. Proved: `src/spec-exit-codes.test.ts` parses the 24 `**CLI exit code:**` lines out of `SPEC.md`, fails on a line it does not recognise, and runs the CLI on each fixture with and without `--exit-code`.
- [x] Snapshots reviewed; each snapshot change is explained in its PR. Proved: `src/__snapshots__/render.test.ts.snap` holds 10 snapshots (EX-01, 02, 17, 19, 20, 24 as `check`; EX-01, 17 as `suggest`; EX-22, 01 as `explain`). They are new in the Task 5 commit (first rendering, no earlier text to diff against); each was read against the plan's content rules before it was committed. `*.snap` is `eol=lf` in `.gitattributes` so Windows and Linux compare equal.
- [x] No interactive prompt anywhere (CLI-13). Proved: `main` fails at once on a TTY without reading stdin (`src/main.test.ts`, `readStdin` not called), and a spawned child with stdin ignored or an empty pipe exits 2 instead of hanging (`test/bin.test.ts`); only `bin.ts` touches `process` (`test/closeout.test.ts`).
- [x] `tempo --help` documents every flag and exit code. Proved: `src/args.test.ts` (every command, `--json`, `--exit-code`, `--now`, `--help`, `-h`, `--version` and a line for each of the exit codes 0 … 4, ASCII-only), `test/closeout.test.ts` (every code in `EXIT`).
- [x] CLI coverage ≥ 95 % line and branch (QG-01). Proved on a fresh clone of `m3/t07-closeout` (code commit 0e77314; Windows, pnpm 12.15.0, Node 24.11.1): `pnpm test:coverage` exit 0, CLI 98.06 % statements, 98.48 % lines, 96.06 % branches over `src/**/*.ts` except tests and `bin.ts` (gate in `packages/cli/vitest.config.ts`).
- [x] Fresh-clone run (same clone): `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm lint`, `pnpm test` (repo 26 passed + 1 todo, core 595 passed, cli 202 passed), `pnpm test:coverage`, `pnpm build` and `pnpm gen:schema` all exit 0, and `git status --short` is empty afterwards.
- [x] By-hand runs of the built binary (`node packages/cli/dist/bin.js`, Windows PowerShell 5.1.26100 and Git Bash, request with the `partyId` `Zoë`): `explain f.json --json` (file), `cat f.json | tempo explain --json` / `Get-Content -Encoding UTF8 f.json | tempo explain --json` (pipe) and `tempo explain --json < f.json` (redirect, via `cmd /c` in PowerShell) give byte-identical output in Git Bash and in PowerShell; files saved by `Out-File` and `Set-Content -Encoding utf8` (UTF-8 with BOM here) give the same output as the plain file. **Environment limit, not a CLI bug (for the M4 README):** `Get-Content f.json | tempo` **without** `-Encoding UTF8` decodes a BOM-less UTF-8 file as ANSI before the process sees it, so `Zoë` arrives as `ZoÃ«`; use `-Encoding UTF8`, pass the file path, or use `<` redirection.

---

## M4 — Schema, agent skill, examples, README (Week 5)

**Goal:** make Tempo usable by agents and by someone who has never seen the repo.

**Scope**

* `schema/rules.schema.json` generated and published with the package; example input files validate against it (CORE-41).
* **`SKILL.md` at the repo root**, tool-agnostic (D16): how an agent drives the CLI through pipes, with example invocations and expected exit codes (CFG-08, CFG-09).
* `examples/` mirroring the n8n flow, including an importable n8n workflow that calls `tempo check --json` (replaces the earlier "n8n Code-node snippet": the Code-node logic is what Tempo replaces), and the files used by the README demo.
* README final: pitch, why, install, a real `tempo explain` demo that is reproducible on Windows PowerShell and bash (CLI-19, DOC-03).

**Definition of done**

- [x] CFG-08, CFG-09, CLI-19, DOC-03 pass. Proved: `tests/repo.test.ts` (CFG-08 `SKILL.md` exists, `it.todo` removed), `packages/cli/test/skill.test.ts` (CFG-09: every fenced `bash` example in `SKILL.md` parses, names existing files and returns its documented exit code through `main`; a mutated exit code fails 2 tests), `packages/cli/test/readme-demo.test.ts` (CLI-19: the README input block is `examples/demo.json` byte for byte and `explain --json` on it reproduces the README output and `examples/demo.explain.json`; DOC-03: every README command starts with a known program, has no line continuation and names existing files).
- [x] Example inputs validate against the generated JSON Schema. Proved: `packages/core/test/example-files.test.ts` (ajv 2020 over `examples/demo.json` and `examples/inputs/*.json`; a negative control without `participants` fails validation); the schema also ships in the package (A-82: `npm pack --dry-run` lists `schema/rules.schema.json`, `packages/core/test/schema-package.test.ts`).
- [x] A person on Windows/PowerShell can run the README demo copy-paste. Proved by hand on a fresh clone, recorded here by the implementer and not reproducible from the repo (Windows 11, Windows PowerShell 5.1.26100.9711, pnpm 12.15.0, Node 24.11.1): the README's quick-start command, the `tempo explain examples/demo.json --json` form and `Get-Content examples/demo.json -Raw | tempo explain --json` all print `"decision": "counter_offer"` and exit 0, `--exit-code` exits 1, and the three 5.1 variants of the non-ASCII note print `Zoë`. (`tempo` was a function around `node packages/cli/dist/bin.js` because nothing is published.)
- [x] n8n workflow (`examples/n8n/`) runs in a real n8n. Proved: `node examples/n8n/verify.mjs` on n8n 2.38.7 in an isolated user folder: EX-01 reaches Book slot, EX-17 Offer alternatives, EX-23 Report input error (`AMBIGUOUS_ZONE`, 3 candidates), on copies of the workflow patched with the case request and absolute paths (the committed file, with its placeholder Linux path, was not itself executed); results pinned in `examples/n8n/verified.json` (A-83, A-84, A-87).
- [x] Independent review of the five CLI test files the M3 review skipped: `docs/reviews/m3-cli-tests.md` (4 of 7 weak items fixed and 3 deliberately left, 16 missing behaviours now covered, 6 hand mutations all caught, 1 open production finding, A-85).
- [x] Fresh-clone run (local clone of `main` at 38c4288, Windows, Node 24.11.1, pnpm 12.15.0): `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm lint`, `pnpm test` (repo 27 passed, core 612 passed, cli 269 passed + 1 todo), `pnpm test:coverage` (CLI 98.71 % statements, 97.67 % branches, 98.48 % lines), `pnpm build` and `pnpm gen:schema` all exit 0, `git status --short` is empty afterwards, and `npm pack --dry-run` lists `schema/rules.schema.json` in core and `dist/bin.js` in the CLI.
- [x] CI green on the Linux and Windows jobs (ubuntu/windows x Node 24/26) after the push. Proved: `gh run view 42057980284` (push of `main` at 2f4958f) shows `completed / success` and all four `verify` jobs `success`.

**Corrections found in M4.** (1) The M3 by-hand note above says `Get-Content -Encoding UTF8 f.json | tempo` works in PowerShell 5.1. Measured again in M4: with the default `$OutputEncoding` (US-ASCII) it prints `Zo?`, and without `-Encoding` it prints `Zo??`; it works only when `$OutputEncoding = [System.Text.UTF8Encoding]::new($false)` is also set (or with a file path or `cmd /c "... < f.json"`). The README and `SKILL.md` carry the corrected note. (2) `--help` says an ambiguous-zone error "lists the candidate zones", but the human-readable line does not (only `--json` does): open as A-85.

## M5 — Hardening and documentation review (Week 6, first half)

**Scope**

* Mutation testing at the threshold (QG-02); coverage gate enforced in CI (QG-01).
* Extra DST edge-case fixtures if the property runs find gaps; fixtures export stable (QG-05).
* Documentation consistency pass: DOC-01 … DOC-03; every `A-nn` resolved or accepted; no TODOs in the planning docs.
* Secret scan; `.npmrc` and workflows contain no tokens.

**Definition of done**

- [ ] QG-01 … QG-05 green (open: the nightly `mutation-score` item below). Local evidence (fresh clone of `main`, Windows, Node 24.11.1, pnpm 12.15.0, 2026-11-06):
  - [x] QG-01: `pnpm test:coverage` exit 0; core 100 % lines, 99.39 % branches, 100 % functions (thresholds 95/95/100).
  - [x] QG-02: combined mutation score 98.95 % on CI (run 42124645347, break 70); survivors in `docs/reviews/m5-mutation.md`. A second run (42129787308) is recorded there for reproducibility.
  - [x] QG-03, QG-04: pinned by `tests/repo.test.ts`; CI run 42131512161 on `main` after the push: all four `verify` jobs (ubuntu/windows × Node 24/26) green.
  - [x] QG-05: `packages/core/test/fixtures-lock.test.ts` and `fixtures.lock.json`.
  - [ ] The nightly `mutation-score` job has been green once via `workflow_dispatch` (run 42124645347, on the branch); tick after it also runs green from `main`.
- [x] All five planning docs match the shipped behaviour: spot-check tables in `docs/reviews/m5-docs-match.md`; signed off by owner, 2026-11-06.
- [x] No open `Needs approval` rows in `ASSUMPTIONS.md`: `tests/docs.test.ts` (DOC-04).

## M6 — Release v0.1.0 (Week 6, second half)

**Scope**

* changesets version both packages to **`0.1.0`**; CHANGELOG generated by changesets (never hand-edited).
* The release workflow publishes `@marvinliem/tempo-core` and `@marvinliem/tempo` **from GitHub Actions** with provenance (OIDC); nothing is published from a local machine.
* Tag `v0.1.0`, GitHub release notes.
* Post-release verification on Linux and Windows: `npm view` both packages; `npx @marvinliem/tempo --version`; run the README demo from the published package.

**Definition of done**

- [ ] `npm view @marvinliem/tempo-core` and `npm view @marvinliem/tempo` return `0.1.0`.
- [ ] Provenance badge visible on both npm pages.
- [ ] `v0.1.0` tag and release exist.
- [ ] Downstream note for Deskhand MCP: the public API is `evaluate`, `suggest`, `explain`, the fixtures and the schemas; breaking changes follow the `0.x` rule in ARCHITECTURE §6.

---

## Risks and gates

| Risk | Mitigation |
|---|---|
| `@marvinliem/*` names unavailable | M1 name gate (CFG-10) before anything else |
| Luxon DST behaviour differs between versions | never rely on Luxon defaults for request times (ADR 4); DST fixtures run on the whole CI matrix |
| Oracle shares a bug with the engine | oracle is written independently, minute-based, and validated on the SPEC examples first (ORC-02) |
| Zod / JSON-Schema tooling change | decided at M1 (A-22); drift test CORE-41 |
| Node 26 / Vitest / Stryker compatibility | the CI matrix finds it in M1, not in M6 |
