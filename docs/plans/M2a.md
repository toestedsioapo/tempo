# Milestone 2a — Interval algebra, decision and oracle: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `evaluate()` returns a correct `book` / `counter_offer` decision, with reasons and error results, for everything except slot search and DST-specific handling, and an independent minute-by-minute oracle agrees with it.

**Architecture:** Pure modules in `packages/core/src`: `zones.ts` (zone validation, abbreviation table), `intervals.ts` (availability instances, merge, containment, interval validation), `render.ts` (instants → `IsoSlot`), `reasons.ts` (exact message templates), `evaluate.ts` (orchestration in the SPEC §4.1 order). The oracle lives in `packages/core/test/oracle/` and imports only Luxon, never engine modules. Instants are epoch milliseconds (`number`); wall times become instants only through Luxon with an explicit zone.

**Tech Stack:** unchanged from M1 (TypeScript `~6.0.3`, Luxon `^3.7.2`, Zod `^4.6.7`, Vitest `^5.0.5`); adds `fast-check` as a core devDependency only (A-56).

**Spec:** `ROADMAP.md` §M2a; `SPEC.md` §3.3–§3.5, §4.1–§4.6, §6 (EX-01 … EX-24), §7; `TEST_PLAN.md` §2, §3 (CORE-08 … CORE-23, CORE-40), §5 (ORC-01, ORC-02); `DECISIONS.md` C5–C8, C11, D13, G23, G26, G30, G31; `ASSUMPTIONS.md` A-06, A-07, A-11, A-14, A-16, A-18, A-37.

## Global Constraints

- Everything in M1's Global Constraints still binds: `strict` + `noUncheckedIndexedAccess`; ESM `NodeNext` with `.js` relative imports; core runtime dependencies exactly `luxon` and `zod`; core is pure (no `Date`, `Date.now`, `DateTime.now/local`, zero-argument `DateTime.utc`, `process`, `fs`, `crypto`, `performance`, randomness, network); core never throws, it returns `{ ok: false, error }`; Luxon with an explicit zone everywhere; cross-platform scripts; no production code without a failing test first; Conventional Commits ending with the `Co-Authored-By` trailer; no push before the closing gate.
- Validation order is SPEC §4.1: schema → zones (`request.timeZone`, then `participants[0..n].timeZone`) → intervals (participants in array order, weekdays Monday→Sunday, intervals in array order) → request wall times (DST, M2b). First failure wins.
- Intervals are closed: `m.start <= s && e <= m.end`; instances that overlap or touch (`next.start <= current.end`) merge (A-16).
- An availability instance is owned by the local date it **starts** on; a blackout date removes every instance owned by it and nothing else (C5, C6).
- Reasons are ordered: `IN_PAST` | `INSUFFICIENT_NOTICE`; then per participant sorted by `partyId` (code-unit order) its one failure reason; at most one failure reason per participant (SPEC §3.5, A-11).
- `evaluate` output renders `start`/`end` with Luxon `toISO({ suppressMilliseconds: true })` in `request.timeZone` (`UTC` and `GMT` render `Z`) and `startUtc`/`endUtc` as `YYYY-MM-DDTHH:mm:ssZ` (SPEC §4.9). Equal input gives byte-identical JSON.
- Coverage on the files added in this milestone is ≥ 95 % lines and branches (Task 8).
- The public API changes only deliberately: `packages/core/src/public-api.test.ts` pins it (G31).

## Execution conventions

Same as M1: one branch per task (`git switch main && git switch -c m2a/tNN-<slug>`), merged into local `main` with `--no-ff` after review; task close-out runs `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build` at the root; nothing is pushed until the closing gate (Task 8 Step 6). Anything undecided becomes an `A-nn` row in `ASSUMPTIONS.md` (next free number is A-50), recorded in Task 8.

## Assumptions made by this plan (recorded in Task 8 as `A-50 … A-58`)

| ID | Assumption | Why |
|---|---|---|
| A-50 | `ZoneIdSchema` drops its `min(1)`: `""` passes the schema and becomes `INVALID_ZONE` in the zone step. `schema/rules.schema.json` is regenerated | TEST_PLAN CORE-10 expects `""` → `INVALID_ZONE`; A-37 already says zone validation is a later step than the schema |
| A-51 | `INVALID_ZONE` message is `Unknown time zone "<value>"; use an IANA zone id.`; `AMBIGUOUS_ZONE` message is `Time zone abbreviation "<value>" is ambiguous; use an IANA zone.` with `<value>` as the caller wrote it; `details` are `field` (dotted path such as `participants[1].timeZone`), `value`, and for ambiguity `options` | SPEC fixes only the EX-23 text; INVALID_ZONE text is not specified |
| A-52 | In M2a a `counter_offer` has `slots: []` and no `NO_SLOTS_IN_HORIZON` reason (the search is M2b). Examples that need ranked slots, that reason, `explain`, or DST handling are decision-tier or `todo` | ROADMAP M2a scope |
| A-53 | Rule boundaries and request wall times are converted with Luxon's default gap/overlap resolution (forward / earlier occurrence), which equals the A-07 policy, but M2a emits no `DST_RULE_ADJUSTED` and rejects no DST request times. EX-12, EX-13, EX-22, EX-24 are `todo` until M2b | `dst.ts` and CORE-35 … CORE-39 are M2b |
| A-54 | `evaluate(input: unknown): NegotiationResult` parses internally, so hostile input yields `INVALID_INPUT` (INV-10). `NegotiationRequest` documents the accepted shape. `evaluate` becomes public (DECISIONS G32) | G30 says the entry points take `NegotiationRequest`; `unknown` accepts it and keeps "never throws" honest |
| A-55 | ORC-01 generators avoid dates within ±1 day of a transition of the chosen zone (G-01/G-02 DST oversampling is M2b). ORC-02 runs the oracle on every `ok: true` example except EX-24 (rule boundary inside a gap; the oracle does not mirror A-07). Any other disagreement is a bug to investigate, not to exclude | ROADMAP says ORC-01 uses G-03/G-04 only; the oracle reads wall times per minute and cannot share the engine's gap policy |
| A-56 | `fast-check` is a core devDependency; property runs are 200 per property in M2a | TEST_PLAN stack; nightly 5,000 runs arrive in M2b |
| A-57 | `fixtures/examples/ex-01 … ex-24.json` are generated from `SPEC.md` §6 by the committed `packages/core/scripts/extract-fixtures.ts` (fail loudly on any unrecognised input line); a drift test compares the files with a fresh extraction | M1's three fixtures were produced by an uncommitted script; the review asked for a reproducible one |
| A-58 | The 95 % gate (QG-01) is enforced in `packages/core/vitest.config.ts` for the files added in M2a only; M2b widens it to all of core | ROADMAP M2a Definition of done |

## Review Focus

Inputs the spec implies but the TEST_PLAN M2a rows do not exercise; each has a test in the named task.

1. **Zone strings that are not IANA ids:** `"UTC+3"`, `"+05:30"`, `" UTC"`, `"utc"`, `"ist"`, `"Etc/UTC"`, `"CET"`: fixed offsets are `INVALID_ZONE`, lowercase table hits are ambiguous, legacy ids outside the table are accepted. → Task 1.
2. **Hostile and malformed input to `evaluate`** (`null`, `42`, `[]`, `{}`, a throwing getter): returns `INVALID_INPUT`, never throws. → Task 4.
3. **Participant order:** `[bob, alice]` and `[alice, bob]` give identical results; reasons follow `partyId` order. → Task 4.
4. **Requests touching boundaries:** a request ending exactly at `00:00` / at an availability end, spanning a join between touching rules, and one that starts at an overnight rule's wrap. → Tasks 2 and 4.
5. **Extreme options:** `minNoticeMinutes` 525600 and a `now` far in the past or future must not overflow or change the decision logic. → Task 3.

---

## File structure

```
packages/core/src/   zones.ts intervals.ts render.ts reasons.ts evaluate.ts  (+ *.test.ts beside each)
                     index.ts (adds evaluate)   schema.ts (ZoneIdSchema)
packages/core/scripts/extract-fixtures.ts
packages/core/fixtures/examples/ex-01.json … ex-24.json
packages/core/test/  examples.test.ts  fixtures-drift.test.ts  oracle/oracle.ts  oracle/oracle.test.ts  oracle/differential.prop.test.ts  helpers.ts (extended)
packages/core/vitest.config.ts
docs/plans/M2a.md
```

---

### Task 1: Zone validation (CORE-08 … CORE-10)

**Files:**
- Create: `packages/core/src/zones.ts`, `packages/core/src/zones.test.ts`
- Modify: `packages/core/src/schema.ts` (`ZoneIdSchema`), `packages/core/src/schema.test.ts`, `schema/rules.schema.json` (regenerated by `pnpm gen:schema`, never by hand)

**Interfaces:**
- Produces: `ZONE_ABBREVIATIONS: Readonly<Record<string, readonly string[]>>` (keys upper-case, the seven rows of SPEC §7 with `options` in the listed order); `validateZone(value: string, field: string): ErrorResult | null`; `validateZones(request: ResolvedNegotiationRequest): ErrorResult | null` (checks `request.timeZone` first, then `participants[i].timeZone` in array order; `field` values `request.timeZone`, `participants[1].timeZone`).
- Consumes: `ErrorResult`, `ResolvedNegotiationRequest` from `types.ts`; Luxon `IANAZone.isValidZone`.

- [ ] **Step 1: Branch** `m2a/t01-zones`.
- [ ] **Step 2: Write failing tests** in `zones.test.ts` (`it.each` tables): CORE-08, each of the seven abbreviations → `AMBIGUOUS_ZONE` with exactly the SPEC §7 `options` array and message `Time zone abbreviation "IST" is ambiguous; use an IANA zone.` (EX-23 text; `details` equals `{ field, value, options }`). CORE-09: `UTC`, `GMT`, `Etc/UTC`, `Europe/London`, `CET` → `null`; `ist` and `Ist` → `AMBIGUOUS_ZONE` with `value` as written. CORE-10 plus Review Focus 1: `Mars/Olympus`, `""`, `" UTC"`, `"UTC+3"`, `"+05:30"` → `INVALID_ZONE` with message `Unknown time zone "<value>"; use an IANA zone id.` and `details` `{ field, value }` (A-51). `validateZones`: `request.timeZone = "Mars/Olympus"` with `participants[0].timeZone = "IST"` reports the request zone (CORE-11, zone half); participants are checked in array order. In `schema.test.ts`, change the `ZoneIdSchema` row for `""` to accepted.
- [ ] **Step 3: Red** `pnpm --filter @marvinliem/tempo-core test zones schema` → FAIL.
- [ ] **Step 4: Implement** `zones.ts` (table lookup upper-cased and case-insensitive first, then `UTC`/`GMT` accepted, then `IANAZone.isValidZone`) and relax `ZoneIdSchema` to `z.string()`. Run `pnpm gen:schema`.
- [ ] **Step 5: Green** the same command; `pnpm test` (the schema drift test must pass with the regenerated file), `pnpm typecheck`, `pnpm lint`.
- [ ] **Step 6: Commit** `feat(core): zone validation before Luxon (CORE-08..10)`

---

### Task 2: Interval algebra (CORE-12 … CORE-20, EX-09)

**Files:**
- Create: `packages/core/src/intervals.ts`, `packages/core/src/intervals.test.ts`

**Interfaces:**
- Produces: `type Span = { readonly startMs: number; readonly endMs: number }`; `type Instance = Span & { readonly ownerDate: LocalDate; readonly weekday: DayName; readonly rule: Interval }`; `wallTimeToMs(date: LocalDate, time: ClockTime | EndTime, zone: ZoneId): number` (`"24:00"` means the next date at `00:00`); `expandInstances(party: PartyRules, fromMs: number, toMs: number): Instance[]` (one instance per rule per local date from two days before `fromMs` to one day after `toMs` in the party's zone, sorted by `startMs`; overnight and `24:00` ends per SPEC §4.3; blackouts are NOT applied here); `applyBlackouts(instances: readonly Instance[], blackouts: readonly LocalDate[]): Instance[]` (drops instances whose `ownerDate` is listed); `mergeSpans(spans: readonly Span[]): Span[]`; `contains(merged: readonly Span[], span: Span): boolean`; `findInvalidInterval(request: ResolvedNegotiationRequest): ErrorResult | null` (first rule with `start == end`: code `INVALID_INTERVAL`, message `Availability interval start and end must differ.`, `details` `{ field: "participants[1].weeklyRules.monday[0]", start, end }`; order: participants in array order, weekdays Monday→Sunday, intervals in array order).
- Consumes: types from `types.ts`, `DAY_NAMES`; Luxon `DateTime.fromObject(..., { zone })`.

- [ ] **Step 1: Branch** `m2a/t02-intervals`.
- [ ] **Step 2: Write failing tests** (values from SPEC §4.3 and EX-01 / EX-05 / EX-07 / EX-14):
  - `expandInstances`: New York party monday 09:00–17:00 around 2025-01-06 contains an instance `[2025-01-06T14:00:00Z, 2025-01-06T22:00:00Z]` with `ownerDate "2025-01-06"`, `weekday "monday"` (EX-01); overnight `20:00–06:00` is owned by its start date and ends the next morning; `end "24:00"` ends at next-day `00:00`; Berlin overnight `22:00–06:00` on 2025-03-29 is 7 real hours (EX-14); the weekday comes from the owner date in the party's zone (CORE-12 half: a party in `Asia/Manila` reads `tuesday` for an instant that is Monday evening in New York).
  - `mergeSpans`/`contains` (CORE-14, CORE-15): touching spans merge, spans one minute apart do not; `[16:00, 17:00]` is contained in `[09:00, 17:00]`, `[16:01, 17:01]` is not; unsorted input; empty input.
  - `applyBlackouts` (CORE-16 … CORE-18): blackout `2025-01-06` removes Monday's instances for a Manila party and a blackout `2025-01-05` (the UTC date) does not; the blackout on the day after an overnight start leaves it intact; `[]` is a no-op.
  - `findInvalidInterval`: EX-09 shape; two offenders report the first in the stated order; none → `null`.
- [ ] **Step 3: Red** `pnpm --filter @marvinliem/tempo-core test intervals` → FAIL.
- [ ] **Step 4: Implement** the signatures above. Spans are epoch milliseconds, built only through Luxon with the party zone; no `Date`.
- [ ] **Step 5: Green**; `pnpm typecheck`, `pnpm lint`.
- [ ] **Step 6: Commit** `feat(core): availability instances, merge and containment (CORE-12..20)`

---

### Task 3: Request interval, time gates, rendering, reason templates (CORE-22, CORE-23)

**Files:**
- Create: `packages/core/src/render.ts`, `packages/core/src/render.test.ts`, `packages/core/src/reasons.ts`, `packages/core/src/reasons.test.ts`, `packages/core/src/gates.ts`, `packages/core/src/gates.test.ts`

**Interfaces:**
- Produces in `gates.ts`: `requestedSpan(request: ResolvedNegotiationRequest["request"]): Span` (C7: `end > start` same date, else next date; the schema already rejects `start == end`); `type TimeGate = "OK" | "IN_PAST" | "INSUFFICIENT_NOTICE"`; `timeGate(startMs: number, nowMs: number, minNoticeMinutes: number): TimeGate`.
- Produces in `render.ts`: `formatUtc(ms: number): UtcInstant`; `toIsoSlot(span: Span, zone: ZoneId): IsoSlot` (SPEC §4.9: offset form in `zone`, `Z` for `UTC`/`GMT`).
- Produces in `reasons.ts`: `inPast(startUtc, now)`, `insufficientNotice(startUtc, minNoticeMinutes, bound)`, `outsideAvailability(partyId)`, `inBlackout(partyId, date)`, each returning `Reason` with the exact SPEC §3.5 template and `participantId` where scoped.
- Consumes: `Span` from Task 2.

- [ ] **Step 1: Branch** `m2a/t03-gates-render`.
- [ ] **Step 2: Write failing tests:** `requestedSpan`: `09:30→10:30` is one hour; `23:00→01:00` ends the next day (EX-08); `00:00` end means next midnight; across the New York spring-forward the real duration differs from nominal (use `2025-03-09` `01:00→04:00`: 2 real hours). `timeGate` (CORE-22, CORE-23): `start == now` → `OK`; `now = start + 1s` → `IN_PAST`; `minNotice 120`, `now = start − 120 min` → `OK`; `now = start − 120 min + 1 s` → `INSUFFICIENT_NOTICE`; Review Focus 5: `minNoticeMinutes 525600` with `now` far in the past and the future gives the expected gate. `toIsoSlot`: EX-01 slot `{ start: "2025-01-06T09:30:00-05:00", end: "2025-01-06T10:30:00-05:00", startUtc: "2025-01-06T14:30:00Z", endUtc: "2025-01-06T15:30:00Z" }`; `Europe/London` in winter renders `+00:00`; `UTC` and `GMT` render `Z`; Kathmandu renders `+05:45`. `reasons`: every message equals the SPEC §3.5 template with sample values (`Requested start 2025-01-06T14:30:00Z is before now 2025-01-06T14:30:01Z.` etc.).
- [ ] **Step 3: Red** → FAIL. **Step 4: Implement** the signatures. **Step 5: Green**, `pnpm typecheck`, `pnpm lint`.
- [ ] **Step 6: Commit** `feat(core): request interval, time gates, slot rendering, reason templates`

---

### Task 4: `evaluate()` (CORE-11, CORE-13, CORE-19 … CORE-21; public API)

**Files:**
- Create: `packages/core/src/evaluate.ts`, `packages/core/src/evaluate.test.ts`
- Modify: `packages/core/src/index.ts`, `packages/core/src/public-api.test.ts`, `DECISIONS.md` (row G32: `evaluate` is public, takes `unknown`, A-54)

**Interfaces:**
- Consumes: `parseNegotiationRequest`, `validateZones`, `findInvalidInterval`, `requestedSpan`, `timeGate`, `expandInstances`, `applyBlackouts`, `mergeSpans`, `contains`, `toIsoSlot`, `formatUtc`, the reason builders.
- Produces: `evaluate(input: unknown): NegotiationResult`, exported from `index.ts` (add `"evaluate"` to `PUBLIC_VALUES` in the public-API test). Flow: parse (errors as values) → zones → intervals → request span → time gate → per participant sorted by `partyId`: merged instances **with** blackouts contain the span? else, merged instances **without** blackouts contain it → `IN_BLACKOUT` (`{date}` = `ownerDate` of the earliest blocked instance that intersects the request) else `OUTSIDE_AVAILABILITY`. `book` iff gate `OK` and every participant available: `slots = [requested]`, `reasons = []`. Otherwise `counter_offer`, `slots = []` (A-52), `reasons` ordered per Global Constraints. `requested` is `toIsoSlot(span, request.timeZone)`.

- [ ] **Step 1: Branch** `m2a/t04-evaluate`.
- [ ] **Step 2: Write failing tests** (`evaluate.test.ts`, built from `test/helpers.ts` `validRequest`/`withChange`):
  - EX-01 as a whole object (`toEqual` its `expected`), EX-09 and EX-10 and EX-23 error results exactly.
  - CORE-11: ambiguous zone in `participants[1]` plus an invalid interval in `participants[0]` → the zone error; a schema error beats both.
  - CORE-12: request `2025-01-06 20:00→21:00` in `America/New_York`, alice (New York) monday 19:00–22:00, bob (`Asia/Manila`) tuesday 08:00–11:00 → `book`; with bob having only a `monday` rule → `counter_offer` and one reason `OUTSIDE_AVAILABILITY` for `bob`.
  - CORE-13: split shift 09:00–12:00 and 13:00–17:00, request 12:00–13:00 → `counter_offer`, `OUTSIDE_AVAILABILITY`. CORE-14 end to end: rules 09:00–12:00 + 12:00–17:00, request 11:30–12:30 → `book`; second rule starting 12:01 → `counter_offer`. CORE-15: request ending exactly at the availability end → `book`, one minute later → `counter_offer`.
  - CORE-17: alice (`UTC`) sunday 22:00–06:00, request monday `2025-01-06` 01:00–02:00: blackout `2025-01-06` still `book`; blackout `2025-01-05` → `counter_offer` with `IN_BLACKOUT` and message date `2025-01-05`.
  - CORE-19: weekend-only rules book on Saturday `2025-01-04` and Sunday `2025-01-05`. CORE-20: `weeklyRules: {}` → `OUTSIDE_AVAILABILITY`. CORE-21: a blackout that does not make a failing participant fail only because of the blackout reports `OUTSIDE_AVAILABILITY`; a participant that would fit but for the blackout reports `IN_BLACKOUT`; never two failure reasons for one participant.
  - Gate reasons: CORE-22/23 end to end (`IN_PAST` first, then participant reasons).
  - Review Focus 2: `evaluate` over `null`, `42`, `"x"`, `[]`, `{}`, an object whose property getter throws → each `INVALID_INPUT`, no throw. Review Focus 3: participants `[bob, alice]` equals `[alice, bob]` and reasons follow `partyId` order. Review Focus 4: request `23:30→00:00` against a `24:00` end and a request spanning the touching join of two rules.
  - Determinism: two calls give `toStrictEqual` results and equal `JSON.stringify`.
- [ ] **Step 3: Red** `pnpm --filter @marvinliem/tempo-core test evaluate public-api` → FAIL. **Step 4: Implement** `evaluate.ts`; add the export and the `PUBLIC_VALUES` entry. **Step 5: Green**, `pnpm typecheck`, `pnpm lint`, `pnpm build`.
- [ ] **Step 6: Commit** `feat(core): evaluate() decision and reasons (CORE-11..23)`

---

### Task 5: Fixtures for all 24 examples and the examples test (EX-01 … EX-24)

**Files:**
- Create: `packages/core/scripts/extract-fixtures.ts`, `packages/core/fixtures/examples/ex-02.json … ex-24.json` (all but the three that exist are new; existing ones are regenerated), `packages/core/test/examples.test.ts`, `packages/core/test/fixtures-drift.test.ts`

**Interfaces:**
- Produces: `extractFixtures(specText: string): { id: string; json: string }[]` exported from the script (the CLI entry writes `fixtures/examples/<id lower-case>.json` with LF endings, only when run directly); fixture format `{ "id": "EX-04", "entry": "evaluate", "input": …, "expected": … }` with `entry: "explain"` for EX-22. `input` is built from the SPEC §6 Input bullet list (request line, one line per participant with `monday–friday` expanded to five keys, blackouts if listed, options line with only the options named; others omitted so defaults apply); `expected` is the SPEC Output JSON block verbatim. Any unrecognised Input line makes the script fail with the example id and the line.

- [ ] **Step 1: Branch** `m2a/t05-fixtures-examples`.
- [ ] **Step 2: Write failing tests:** `fixtures-drift.test.ts` (paths from `import.meta.dirname`): `extractFixtures(SPEC.md)` returns 24 entries `EX-01 … EX-24` and every one equals the committed file's bytes; every `input` passes `NegotiationRequestSchema` except EX-10 (INVALID_INPUT, as designed) and EX-09/EX-23/EX-12/EX-13 inputs that are schema-valid but fail later — assert only `input` is an object for those. `examples.test.ts` is table-driven with three tiers:
  - **exact** — `evaluate(input)` `toEqual(expected)`: EX-01, 03, 05, 07, 08, 09, 10, 14, 15, 23.
  - **decision** — compare `ok`, `decision` and the list of `(code, participantId)` of `reasons` after removing `NO_SLOTS_IN_HORIZON` and `DST_RULE_ADJUSTED` (M2b, A-52/A-53): EX-02, 04, 06, 11, 16, 17, 18, 19, 20, 21.
  - **todo** (`it.todo`, with the M2b reason in the title): EX-12, EX-13 (DST rejection), EX-22 (`explain`), EX-24 (`DST_RULE_ADJUSTED` exact); EX-24's decision (`book`) is still asserted in the decision tier.
- [ ] **Step 3: Red** → FAIL (script and fixtures missing). **Step 4: Implement** the extractor, run it with `pnpm --filter @marvinliem/tempo-core exec tsx scripts/extract-fixtures.ts`, review `git diff` on EX-01/10/22 (they must not change meaningfully). **Step 5: Green**, `pnpm typecheck`, `pnpm lint`; if a decision-tier or exact example fails, the engine or the extraction is wrong — fix that, never the fixture.
- [ ] **Step 6: Commit** `test(core): all 24 SPEC examples as fixtures; examples test (EX-01..EX-24)`

---

### Task 6: Brute-force oracle and ORC-02

**Files:**
- Create: `packages/core/test/oracle/oracle.ts`, `packages/core/test/oracle/oracle.test.ts`

**Interfaces:**
- Produces: `oracleDecision(input: OracleInput): { decision: "book" | "counter_offer"; failing: string[]; gate: "OK" | "IN_PAST" | "INSUFFICIENT_NOTICE" }` where `OracleInput` is the plain JSON request (a local structural type; no import of engine modules, only `luxon` and type-only imports are allowed). Algorithm (ORC-01): compute the request start/end itself with Luxon in `request.timeZone`; for each participant and each UTC minute in `[start, end)` ask: converting this minute to the party's zone, is its wall reading inside some rule of the owner date (the local date, or the previous date for overnight / `24:00` rules) whose owner date is not a blackout? `failing` is the sorted partyIds with any unavailable minute; the gate is computed from `now` and `minNoticeMinutes` independently.
- Consumes: `fixtures/examples/*.json`.

- [ ] **Step 1: Branch** `m2a/t06-oracle`.
- [ ] **Step 2: Write failing test (ORC-02):** for every fixture with `expected.ok === true` except EX-24 (A-55), `oracleDecision(input)` has `decision` equal to `expected.decision` and `failing` equal to the sorted `participantId`s of the failure reasons (`OUTSIDE_AVAILABILITY` / `IN_BLACKOUT`) in `expected.reasons`; the gate equals `IN_PAST` / `INSUFFICIENT_NOTICE` when such a reason is present, else `OK`. The test also asserts that exactly 18 examples were checked: 24 minus the five error examples (EX-09, 10, 12, 13, 23, whose expected result is `ok: false`) minus EX-24 (A-55); the excluded ids are a named constant in the test.
- [ ] **Step 3: Red** → FAIL. **Step 4: Implement** the oracle as slowly and plainly as needed. **Step 5: Green**; if the oracle disagrees with an example other than EX-24, investigate which side is wrong and report it; do not add exclusions.
- [ ] **Step 6: Commit** `test(core): independent minute-by-minute oracle validated on the SPEC examples (ORC-02)`

---

### Task 7: Differential property test (ORC-01, decision only)

**Files:**
- Create: `packages/core/test/oracle/differential.prop.test.ts`
- Modify: `packages/core/package.json` (`pnpm --filter @marvinliem/tempo-core add -D fast-check`), `packages/core/test/helpers.ts` (generators)

**Interfaces:**
- Produces: fast-check arbitraries in `helpers.ts`: zone from `America/New_York`, `Europe/Berlin`, `Australia/Sydney`, `Australia/Lord_Howe`, `Asia/Manila`, `Asia/Kolkata`, `Asia/Kathmandu`, `UTC` (E18); a request date chosen so it is more than one day from any transition of both the requester zone and every participant zone (find transitions by scanning offsets with Luxon in the test helper); rules per G-03 (overnight, `24:00` ends, touching, overlapping, split shifts, empty days); blackouts per G-04 (owner dates, the day after an owner date, dates that differ between UTC and the party's zone); durations 15 min – 23 h 59 min; 2–4 participants; `searchHorizonDays` fixed at its default and unused.
- Consumes: `evaluate`, `oracleDecision`.

- [ ] **Step 1: Branch** `m2a/t07-differential`.
- [ ] **Step 2: Write failing test** (`numRuns: 200`): for each generated input, `evaluate(input)` is `ok: true` and its `decision` equals `oracleDecision(input).decision`, and the sorted participant ids of its failure reasons equal `oracleDecision(input).failing`, and its gate reason (`IN_PAST`/`INSUFFICIENT_NOTICE`/none) equals the oracle's `gate`. Also a generator sanity test: at least 25 % of generated requests are `book` and at least 25 % `counter_offer` over 200 samples (so the property is not vacuous).
- [ ] **Step 3: Red** → FAIL (arbitraries missing). **Step 4: Implement** the arbitraries and the property. **Step 5: Green** at 200 runs, then once at 2,000 runs locally (`FC_NUM_RUNS`-style override via the test's `numRuns`, not committed) to shake out disagreements; any disagreement is a real bug in the engine or oracle — fix the code, add the shrunk counterexample as a fixed regression test. `pnpm typecheck`, `pnpm lint`.
- [ ] **Step 6: Commit** `test(core): differential property test against the oracle (ORC-01, decision)`

---

### Task 8: Coverage gate, purity check, close-out and push gate

**Files:**
- Create: `packages/core/vitest.config.ts`
- Modify: `packages/core/test/purity.test.ts` (CORE-40 source scan), `tests/repo.test.ts` (core config has `thresholds`; the root-config assertion stays), `ASSUMPTIONS.md` (A-50 … A-58), `DECISIONS.md` (G32 if not added in Task 4), `TEST_PLAN.md` (CORE-46 source scan note if numbered; mark CORE-08 … CORE-23 and the M2a examples as implemented), `ROADMAP.md` (tick the M2a Definition of done with the proving command), `CLAUDE.md` (Current phase line only)

**Interfaces:**
- `packages/core/vitest.config.ts`: `test.coverage` `{ provider: "v8", include: ["src/zones.ts","src/intervals.ts","src/render.ts","src/reasons.ts","src/gates.ts","src/evaluate.ts"], thresholds: { lines: 95, branches: 95 } }`, reporters unchanged from M1 (`text`, `lcov`, `json-summary`).
- CORE-40 source scan: no non-comment line under `packages/core/src` (excluding `*.test.ts`) contains `Date.now`, `new Date`, `process.`, `node:fs` or `from "fs"` (comment stripping may reuse the helper idea from `tests/repo.test.ts`, with its string-literal limit noted in a comment).

- [ ] **Step 1: Branch** `m2a/t08-closeout`.
- [ ] **Step 2: Write failing tests:** the CORE-40 source scan; the repo test that `packages/core/vitest.config.ts` text contains `thresholds` with `95`.
- [ ] **Step 3: Red** → FAIL. **Step 4: Implement** the config. Run `pnpm test:coverage`; if any listed file is below 95 % lines or branches, add the missing tests (not exclusions) and re-run until `pnpm --filter @marvinliem/tempo-core test:coverage` exits 0.
- [ ] **Step 5: Docs and verification:** write A-50 … A-58 from the table above (verify each against the code), tick the ROADMAP M2a Definition of done with the command that proves each, update CLAUDE.md's phase line. On a fresh clone of the branch run and record exit codes and test counts for `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:coverage`, `pnpm build`, `pnpm gen:schema` followed by an empty `git status --short`. Commit `docs: close out milestone 2a and record assumptions A-50..A-58`; merge to local `main` with `--no-ff`.
- [ ] **Step 6: Push gate — stop and ask.** Pushing `main` is outward-facing. After approval: `git push origin main`, `gh run watch`, expect four green jobs; tick nothing CI-dependent before they are green.

---

## Self-review

**Spec coverage (ROADMAP M2a scope):** zone validation CORE-08 … 11 → T1 (CORE-11 zone half), T4 (order end to end). Instances, overnight, `24:00`, `start == end`, blackouts, merge, containment CORE-12 … 21 → T2 (algebra), T4 (decisions). Request interval and gates CORE-22/23 → T3, T4. `evaluate()` with decision and reasons → T4. ORC-01 decision → T6, T7; ORC-02 → T6. Examples EX-01, 03, 05, 07, 08, 09, 10, 14, 15, 23 exact; the rest decision-level → T5. Purity CORE-40 and the 95 % gate → T8. `ASSUMPTIONS.md` → T8.

**Type consistency:** `Span`, `Instance`, `PartyRules`, `ResolvedNegotiationRequest` are defined in T2 / M1 and consumed unchanged in T3 and T4; `Reason` builders (T3) are the only message source for `evaluate` (T4); `oracleDecision`'s `failing` and `gate` (T6) are the fields compared in T7; fixtures (T5) feed T6.

**Known risks:** SPEC bullet-notation variants across the 24 examples may need extractor cases (T5 fails loudly); the oracle and the engine differ by design only at DST gaps (A-55), so any other disagreement is a bug; Luxon's overlap resolution for rule boundaries must be confirmed to match A-07 when M2b adds `dst.ts` (A-53); `ZoneIdSchema` relaxation (A-50) changes the generated JSON Schema, which is a visible, non-breaking widening.
