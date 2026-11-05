# M5 docs-match review

Sections are added task by task. This file currently holds the Task 4 DST audit.

## DST fixture audit (Task 4, Step 5)

Cases: request in a **gap**, request in an **overlap**, availability **rule boundary in a gap**, **rule boundary in an overlap**, **midnight wrap across a transition**. `U` = unit test, `F` = fixture in `fixtures/examples`, `P` = property generator near transitions (`generators.ts` `dateNearTransitionArb`, all five E18 zones, `invariants.prop.test.ts`), `-` = not applicable (Manila has no DST), `?` = no named test found by grep, covered only by `P`.

| zone | gap | overlap | rule boundary in gap | rule boundary in overlap | midnight wrap across transition |
|---|---|---|---|---|---|
| America/New_York | U `dst.test.ts`, F ex-11 | U `dst.test.ts` | U `intervals.test.ts`, `evaluate.test.ts` | ? (P) | ? (P) |
| Europe/Berlin | U `dst.test.ts` | U `dst.test.ts` | ? (P) | ? (P) | U `intervals.test.ts` EX-14 |
| Australia/Sydney | U `dst.test.ts`, F ex-15 | U `dst.test.ts` | ? (P) | ? (P) | ? (P) |
| Australia/Lord_Howe | U `dst.test.ts`, F ex-16 | U `dst.test.ts` | U `intervals.test.ts` | ? (P) | ? (P) |
| Asia/Manila | - (U: never adjusts) | - | - | - | - |

**Verdict.** No cell is *empty* in the sense of having no coverage at all (the property run draws dates within ±2 days of every transition in all five zones), but the cells marked `?` have no named example. No `fixtures/dst/dst-nn.json` was added in M5: a new fixture needs its expected output derived by hand against the oracle (ORC-02), and I did not want to commit unverified expected values.
This is recorded as owner decision **A-92** (see `ASSUMPTIONS.md`): add `dst-nn` fixtures for the `?` cells later (append-only, so adding them never breaks the lock), or accept the property coverage. The `gh run list --workflow nightly` check and a local 5,000-run pass were not done here (the owner's laptop cannot afford the run; the nightly job runs 5,000 per property on CI).

## Secret scan (Task 5)

Date 2026-11-06, 153 commits on all refs.

- Tracked files: `tests/secrets.test.ts` scans every file from `git ls-files` (binary extensions skipped) and passes; `.npmrc` is exactly `engine-strict=true` and `autoload-links=false`.
- History: `git log --all --oneline -G'(npm_[A-Za-z0-9]{36}|ghp_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{22,}|_authToken=[^ |]+|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----)'` returned one commit, `f9f96f9` (the M5 plan). The match is the prose "`_authToken=`" with no value after it: a false positive, no token. (The plan's own looser pattern `github_pat_` and `_authToken=` would match more prose; the stricter pattern above needs a value.)
- Names: `git log --all --name-only` for `.env*`, `credentials*`, `token*`, `*.pem` found no file ever committed.
- Result: no secret in the tree or history; no rotation needed.
