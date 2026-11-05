# Independent review: CLI unit tests the M3 review skipped (M4 Task 1)

**Scope:** `packages/cli/src/{main,args,io,now,render}.test.ts` (and the render snapshot) against `docs/plans/M3.md` Tasks 1-5, its Review Focus 1-5, SPEC section 5 and TEST_PLAN CLI-01 ... CLI-17.
**Method:** a fresh read-only reviewer (no M3 history) produced the verdict tables; the mutation spot-check was run afterwards by the implementer. Verdicts: *pinned* (fails if the behaviour regresses), *weak* (passes with the behaviour broken), *missing* (no test).
**Result:** every M3 plan item that is a CLI-nn row is pinned. 7 items were weak, 16 behaviours had no test, 1 finding is a production defect (F1). 4 of the 7 weak items are fixed and 3 are deliberately left (noted in the table); all 16 missing behaviours now have a test; F1 is open for the owner.

## Weak items (before this task)

| File:line (before) | Item | Why weak | Fixed by |
|---|---|---|---|
| `main.test.ts:214-217` | CLI-11 two files / `- x` is a usage error | both argv forms exit 2 even with the "Too many arguments" check deleted (ENOENT / empty stdin) | `main.test.ts` "two files fail because of the argument count" (files registered, message asserted) |
| `main.test.ts:124-133` | CLI-07 `{}` | asserted the code, not the exit status | `main.test.ts` CLI-07 now asserts exit 2 for `{}` |
| `main.test.ts:330-348` | CLI-17 no stack trace | stack-trace check on stdout only | left: with `--json` stderr is asserted empty; plain-mode stderr stack check not added (noted) |
| `io.test.ts:59-61` | CRLF JSON | `JSON.parse` accepts CRLF, cannot fail | left; the real CRLF contract is `main.test.ts:221-238` and `bin.test.ts` (noted, no change) |
| `io.test.ts:67-71` | trailing garbage | regex accepted any text after the prefix | exact `Invalid JSON: <parser reason>` |
| `now.test.ts:58-64` | input not mutated | only the flag branch ran | clock-with-options branch added |
| `args.test.ts:91-94` | per-command help | only `explain` tested | left (help text is not public API, A-13); noted |

## Missing behaviours (before this task) and the test that now covers each

| Behaviour | Test added |
|---|---|
| `--now` flag with no `options` in the input | `now.test.ts` flag creates options; `main.test.ts` "--now with no options object" |
| flag beats clock without reading the clock when `options` absent | `now.test.ts` |
| `renderJson` indent and trailing newline | `render.test.ts` exact text |
| `renderErrorLine` newline collapse | `render.test.ts`; `main.test.ts` multi-line usage error is one stderr line |
| non-OK `Time gate:` rendering | `render.test.ts` (EX-20 explain) |
| `suggest` with `slots: []` | `render.test.ts` (EX-02) |
| FAIL line with `ruleMatched` | `render.test.ts` (EX-17 explain) |
| `--json` alone, `--now --json` | `args.test.ts`, `main.test.ts` |
| help/version precedence, help before other usage errors, `-h --help` | `args.test.ts` |
| `--now ""` | `args.test.ts` (parses; core rejects later) |
| unknown-option message is one sentence | `args.test.ts` exact message |
| doubled BOM, BOM-only files, lone `0xFF`, NUL-branch message | `io.test.ts` |
| `readFile` rejecting with a string / `null` | `main.test.ts` |
| empty file, empty stdin with `--now` through `main` | `main.test.ts` |
| `--exit-code` byte-identical for `suggest` and `explain`; `suggest` on a book is 0 | `main.test.ts` |
| human-mode exit 3 (stdout empty, one stderr line) | `main.test.ts` |

## Mutation spot-check (hand mutations, each reverted; `git diff` on `src/*.ts` is empty)

| Mutation | Caught before | Caught now |
|---|---|---|
| `now.ts:12` drop `flagNow ??` when `options` is absent | no | yes (2 tests fail) |
| `render.ts:46` `Time gate:` hard-coded to `OK` | no | yes (1) |
| `args.ts:48` drop `firstSentence` | no | yes (1, after adding the exact-message test; first attempt survived) |
| `main.ts:13` drop `e !== null` | no | yes (1) |
| `io.ts:52` drop the doubled-BOM strip | no | yes (1) |
| `render.ts:14` indent `2` -> `0` | no | yes (1) |

Not applied: help/version precedence swap and `main.ts:31` `why` (the tests above pin both; not mutation-run).

## Production finding

**F1 - human-mode `AMBIGUOUS_ZONE` omits the candidate zones.** `tempo check f.json` on EX-23 prints `tempo: AMBIGUOUS_ZONE: Time zone abbreviation "IST" is ambiguous; use an IANA zone.` and exits 3. `--help` says "the error lists the candidate zones" and CLAUDE.md says the same; only `--json` carries `details.options`. Human text is not public API (A-13), and exit code and JSON are unaffected, but help and behaviour disagree. Not fixed here: the plan says a production defect stops and goes to the owner. Options: (a) print the candidates on the error line, (b) reword `--help`. Recorded as A-85; the test is an `it.todo` in `main.test.ts`.

## Other observations (no change made)

- `render.test.ts:86-107` and `main.test.ts:283-284` compare against the renderer's/`helpText()`'s own output: they pin wiring, not content (content is pinned by snapshots and the help tests in `args.test.ts`).
- `main.test.ts:321-326` mocks `evaluate` only; `suggest` and `explain` crash paths rely on the shared try/catch.
- Review Focus 3 (closed stdout) and part of 5 (non-ASCII path through `main`) belong to `bin.test.ts`, outside this review.
