# M5 docs-match review

Sections are added task by task: the docs-match tables (Task 6), the DST audit (Task 4) and the secret scan (Task 5).

## Docs match the shipped behaviour (Task 6)

Scope: the claims that had drifted or that a reader relies on most, each tied to a test or a command. This is a spot-check of those claims, **not** a line-by-line proof of every sentence; the sign-off that the five docs match is the owner's (ROADMAP M5 line).

### SPEC.md
| claim | where it is proved | verdict |
|---|---|---|
| the 24 worked examples are the expected outputs | `packages/core/test/fixtures-drift.test.ts` (DOC-02), `examples.test.ts` | matches |
| exit codes 0/1/2/3/4 and `--json` shape | `packages/cli/src/main.test.ts`, `exit-codes.test.ts`, `spec-exit-codes.test.ts` | matches |
| ambiguous zone is an error with candidates, exit 3 | `main.test.ts` "human-mode ambiguous zone lists the candidate zones" and the `--json` `details.options` | fixed (A-85, option (a): the human line now lists them) |
| `DST_RULE_ADJUSTED` message template | `evaluate.test.ts`, `fixtures/dst/dst-01.json` | matches |

### ARCHITECTURE.md
| claim | where it is proved | verdict |
|---|---|---|
| CLI layout `commands/{check,suggest,explain}.ts` | `ls packages/cli/src` shows `commands.ts` | fixed (A-78): the tree now names `commands.ts` |
| `Env.readStdin(): Promise<string>` | `packages/cli/src/io.ts` returns `Uint8Array` | fixed (A-74): the sketch now says `Uint8Array` |
| core exports named exports only | `packages/core/src/public-api.test.ts` | matches |
| core is pure | `purity.test.ts`, `pnpm lint` | matches |

### TEST_PLAN.md
| claim | where it is proved | verdict |
|---|---|---|
| fixtures exported as `@marvinliem/tempo-core/fixtures` | `packages/core/test/fixtures-package.test.ts` (`npm pack` lists them) | fixed (A-89): the path is `@marvinliem/tempo-core/fixtures/*` |
| QG-01 coverage thresholds | `packages/core/vitest.config.ts`, pinned in `tests/repo.test.ts` | matches |
| QG-02 mutation score | sharded `nightly.yml` jobs, `packages/core/test/mutation-merge.test.ts` | fixed: the row names the command and the jobs |
| QG-05 append-only fixtures | `packages/core/test/fixtures-lock.test.ts` | fixed: the row names the lock (A-91) |
| DOC-01, DOC-04 | `tests/docs.test.ts` | added |
| CORE-41 schema validates fixtures | `packages/core/test/schema-drift.test.ts` | matches |

### ROADMAP.md
| claim | where it is proved | verdict |
|---|---|---|
| M5 definition of done | see the proving commands recorded under M5 in ROADMAP.md | updated in Task 7 |

### DECISIONS.md
| claim | where it is proved | verdict |
|---|---|---|
| D13 core never throws | `packages/core/test/invariants.prop.test.ts` (never-throws invariant) and the `ok`/`error` result types | matches |
| D14 exit codes | `main.test.ts` | matches |
| D16 `SKILL.md` at the repo root | `tests/repo.test.ts` (CFG-08), `packages/cli/test/skill.test.ts` | matches |

### Other drifts from the plan
| claim | where it is proved | verdict |
|---|---|---|
| CLAUDE.md says the assumptions file is `docs/ASSUMPTIONS.md` | `grep -n "docs/ASSUMPTIONS" CLAUDE.md` finds nothing; the file is at the repo root (A-30) | matches |
| CLAUDE.md "Current phase" | edited in this task and again in Task 7 | fixed |
| TEST_PLAN status banners | banners name M4 as the last implemented milestone | owner decision: left as written, they are history |

### TODO / TBD / FIXME / `it.todo`
`grep -rnE "(TODO|TBD|FIXME)|it\.todo"` over `*.md`, `*.ts`, `*.json` (excluding `node_modules`, `dist`, `.stryker-tmp`, `coverage`, `reports`, `.superpowers`): no live `it.todo` or marker in code or tests. The remaining hits are prose that *describes* a past `it.todo` (A-36, ROADMAP M4, TEST_PLAN status banner and CFG-08, `docs/plans/M1`, `M2a`, `M2b`, `M4`, `M5`, `docs/reviews/m3-cli-tests.md`): history, not open work.


## DST fixture audit (Task 4, Step 5)

Cases: request in a **gap**, request in an **overlap**, availability **rule boundary in a gap**, **rule boundary in an overlap**, **midnight wrap across a transition**. `U` = unit test, `F` = fixture in `fixtures/examples`, `P` = property generator near transitions (`generators.ts` `dateNearTransitionArb`, all five E18 zones, `invariants.prop.test.ts`), `-` = not applicable (Manila has no DST), `?` = no named test found by grep, covered only by `P`.

| zone | gap | overlap | rule boundary in gap | rule boundary in overlap | midnight wrap across transition |
|---|---|---|---|---|---|
| America/New_York | U `dst.test.ts`, F ex-11 | U `dst.test.ts` | U `intervals.test.ts`, `evaluate.test.ts` | ? (P) | ? (P) |
| Europe/Berlin | U `dst.test.ts` | U `dst.test.ts` | ? (P) | ? (P) | U `intervals.test.ts` EX-14 |
| Australia/Sydney | U `dst.test.ts`, F ex-15 | U `dst.test.ts` | ? (P) | ? (P) | ? (P) |
| Australia/Lord_Howe | U `dst.test.ts`, F ex-16 | U `dst.test.ts` | U `intervals.test.ts` | ? (P) | ? (P) |
| Asia/Manila | - (U: never adjusts) | - | - | - | - |

**Verdict (owner decision A-92: add named fixtures).** Two cells now have a named fixture; the remaining `?` cells stay covered by `P` only.

| fixture | cell | hand derivation |
|---|---|---|
| `fixtures/dst/dst-01.json` | rule boundary in a fall-back overlap (America/New_York, 2025-11-02) | The overlap is 05:00Z-06:00Z (EDT) then 06:00Z-07:00Z (EST). Bob's Sunday rule `01:30-05:00` starts at 01:30, which is ambiguous; A-07 takes the **earlier** occurrence, 05:30Z. It ends at 05:00 EST = 10:00Z. A UTC request 05:30Z-06:30Z therefore fits (the later occurrence would start bob at 06:30Z and fail it) and `DST_RULE_ADJUSTED` is emitted for bob with the instance start 05:30Z. |
| `fixtures/dst/dst-02.json` | overnight rule crossing a DST night (America/New_York, fall-back) | Bob's Saturday `22:00-06:00` starts 22:00 EDT = 02:00Z on 2025-11-02 and ends 06:00 EST = 11:00Z: **9 real hours**, not the nominal 8. A UTC request 10:00Z-11:00Z fits only if the end is read on the post-transition clock; an 8-hour reading would end at 10:00Z and reject it. Neither boundary is in the overlap, so no note. |

Both are checked by `packages/core/test/dst-fixtures.test.ts` against the engine **and** the independent oracle (`oracleSlots`, A-64): decision, failing parties and gate. The expected values were written from the derivations above before running either. They also appear in `fixtures.lock.json`.
The `gh run list --workflow nightly` check and a local 5,000-run pass were not done (the owner's laptop cannot afford the run; the nightly `properties` job runs 5,000 per property on CI).

## Secret scan (Task 5)

Date 2026-11-06, 153 commits on all refs.

- Tracked files: `tests/secrets.test.ts` scans every file from `git ls-files` (binary extensions skipped) and passes; `.npmrc` is exactly `engine-strict=true` and `autoload-links=false`.
- History: `git log --all --oneline -G'(npm_[A-Za-z0-9]{36}|ghp_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{22,}|_authToken=[^ |]+|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----)'` returned one commit, `f9f96f9` (the M5 plan). The match is the prose "`_authToken=`" with no value after it: a false positive, no token. (The plan's own looser pattern `github_pat_` and `_authToken=` would match more prose; the stricter pattern above needs a value.)
- Names: `git log --all --name-only` for `.env*`, `credentials*`, `token*`, `*.pem` found no file ever committed.
- Result: no secret in the tree or history; no rotation needed.
