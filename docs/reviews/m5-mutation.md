# M5 mutation review (QG-02)

**Command.** Run on GitHub Actions only (the owner's laptop has 7.2 GB RAM): `workflow_dispatch` of `nightly.yml` on branch `m5/t02-stryker`, run 42124645347. Four shards of `stryker run stryker.shard.json --mutate <group> --concurrency 4` with `TEMPO_PROP_RUNS=10` (Stryker 10.1.1, vitest runner, `coverageAnalysis: perTest`), then the `mutation-score` job merges the shard reports (`packages/core/scripts/mutation-merge.ts`) and applies the break threshold (70) to the combined score.
**Date / machine.** 2026-11-05 (UTC) / `ubuntu-latest`, Node 24.
**Run time.** Shards 5 min 15 s (evaluate-suggest), 9 min 36 s (intervals-search), 12 min 29 s (dst-zones), 22 min 46 s (schema-io); the unsharded run had exceeded 120 min.
**Local runs.** Only the one-file smoke on `issues.ts` (18/18) with `TEMPO_PROP_RUNS=50`, concurrency 1.

## Score

| | detected / valid | score |
|---|---|---|
| **combined** | **846 / 855** | **98.95 %** (break 70, low 80, high 90) |
| availability.ts | 51/52 | 98.1 |
| dst.ts | 80/80 | 100 |
| zones.ts | 70/70 | 100 |
| evaluate.ts | 84/84 | 100 |
| explain.ts | 30/31 | 96.8 |
| reasons.ts | 24/24 | 100 |
| suggest.ts | 3/3 | 100 |
| intervals.ts | 136/138 | 98.6 |
| search.ts | 107/107 | 100 |
| parse.ts | 23/26 | 88.5 |
| gates.ts, guard.ts, internal-error.ts, issues.ts, render.ts | 24, 17, 6, 18, 31 (all) | 100 |
| schema.ts | 142/144 | 98.6 |

The score was already above the threshold, so the task is the survivor review. `TEMPO_PROP_RUNS=10` means the property tests contribute little to kills here; the example tests do the work. The nightly `properties` job still runs 5,000.

## Survivors (9 in the first run)

| file:line | mutation | verdict |
|---|---|---|
| `availability.ts:24` | `a.endMs - b.endMs` → `+` in the blacked-out instance tie-break | equivalent: instances with the same start instant have the same owner date, and only `ownerDate` is read from the first one |
| `explain.ts:40` | `decide(request, false)` → `true` | equivalent: `explain` shows `candidates` only when the request failed, and a failed decision already searches; `searchOnBook` only adds a search whose result `explain` discards on `book` |
| `intervals.ts:97` | `a.resolvedMs - b.resolvedMs` → `+` in `adjustmentNotes` | **killed** by `intervals.test.ts` "adjustmentNotes chronological order": a Saturday-night rule whose end resolves to 05:50Z comes before a Sunday rule whose start resolves to 05:10Z, so only the sort puts the notes in order (mutation applied by hand: test fails; original: passes) |
| `intervals.ts:103` | tie-break `endMs` in `mergeSpans` → `+` | equivalent: the union of spans with equal starts does not depend on their order (the merge keeps the larger end) |
| `parse.ts:15` | `"Input could not be read."` → `""` | **killed** by `parse.test.ts` "a throwing getter becomes a root INVALID_INPUT value" (the existing `evaluate.catch.test.ts` mocks `parse.js`, so the real catch was never asserted) |
| `parse.ts:30` (2 mutants: string, `?.`) | `issues[0]?.message ?? "Invalid input."` | equivalent: a failed Zod parse always carries at least one issue, so the fallback is unreachable. Left as defensive code, no `// Stryker disable` added |
| `schema.ts:93` | issue `code: "custom"` → `""` | equivalent: `parseNegotiationRequest` maps only `path` and `message` from Zod issues; the code never reaches the output |
| `schema.ts:94` | duplicate-partyId message → `` | **killed** by `parse.test.ts` "names the duplicated id in the error message and the first issue" |

Three real gaps were closed with tests written against the mutant (each fails on the hand-applied mutation and passes on the original). Five survivors are equivalent or unreachable. No defect found; `git diff --stat packages/core/src` shows test files only.

## Reproducibility (Review Focus 2)

The plan asks for two full runs with matching survivor sets. A second run of the same workflow is started after these tests land; its result and survivor set are recorded below.

- Run 2: _recorded at M5 close-out (see the end of this file)._
