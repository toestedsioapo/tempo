# Tempo — SPEC.md

> **Status:** APPROVED (planning round 3). Implementation proceeds milestone by milestone (`ROADMAP.md`); no engine code exists yet. The Zod schemas (M1) become normative for shapes once written.
> **Precedence:** `DECISIONS.md` is the source of truth. Where this file disagrees with it, this file is wrong.
> **Assumptions:** every choice not fixed by `DECISIONS.md` is listed in [`ASSUMPTIONS.md`](./ASSUMPTIONS.md) as `A-nn` and flagged where it is used.
> **Packages:** `@marvinliem/tempo-core` (library) and `@marvinliem/tempo` (CLI, binary `tempo`). First release: `v0.1.0`.

---

## 1. Overview

Tempo is a TypeScript library and CLI for **cross-time-zone meeting negotiation**. Given a meeting request and the working rules of two or more participants (weekly hours in their own IANA time zone, overnight shifts, blackout dates, DST), it decides whether the request fits everyone. If it does, the decision is `book`. If not, it is `counter_offer`: the reasons why, plus up to three ranked alternative slots.

It generalizes the code step of my n8n **Meeting Scheduler**, where an LLM extracts `{day, start, end, requester time zone}` from an email, a code node converts it to both parties’ local times, checks business-hours windows (one party works 20:00–06:00, so the window wraps midnight), and either books the slot or offers three alternatives in the requester’s local time. Tempo makes that logic deterministic, property-tested, DST-correct and importable. It is the scheduling brain for Deskhand MCP, Deskbench and Deskflow.

Tempo does **not** read calendars, parse natural language, expand recurring meetings or provide a GUI (see §8).

## 2. Design principles

1. **Pure core.** `@marvinliem/tempo-core` has no clock, network, filesystem, environment or randomness. `now` is an input. (`CLAUDE.md` hard rules.)
2. **Errors are values (D13).** Core never throws. Every function returns `{ ok: true, … }` or `{ ok: false, error }`. The CLI maps errors to exit codes.
3. **Never guess.** Ambiguous zone abbreviations, nonexistent local times and ambiguous local times are reported, not resolved (C10, C11).
4. **Absolute-time algebra.** All comparisons happen on UTC instants. Wall-clock times are converted once, with the IANA database, at the edges (C5).
5. **Deterministic.** Same input ⇒ byte-identical output, including ordering and tie-breaks.
6. **Zod is the source of truth.** Types are `z.infer`’d; `schema/rules.schema.json` is generated.
7. **Public contract.** Exit codes and JSON output shapes are public API; changing them is a breaking change.

## 3. Types

The shapes below are descriptive. The Zod schemas (written test-first in Milestone 1) are normative once they exist.

### 3.1 Primitive formats

| Name | Format | Notes |
|---|---|---|
| `LocalDate` | `YYYY-MM-DD` | must be a real calendar date |
| `ClockTime` | `HH:mm`, 24 h, `00:00`–`23:59` | |
| `EndTime` | `ClockTime` or `"24:00"` | `"24:00"` only in availability rules (C5) |
| `UtcInstant` | `YYYY-MM-DDTHH:mm:ssZ` | whole seconds, `Z` only (C8, A-17) |
| `DayName` | `"monday"` … `"sunday"` | lowercase (A-01) |
| `ZoneId` | IANA id, plus `UTC` and `GMT` | abbreviations are errors, see §7 |
| `IsoOffset` | ISO-8601 local time with numeric offset, e.g. `2025-01-06T09:30:00-05:00` | rendering rules in §4.9 |

### 3.2 Input

```ts
type NegotiationRequest = {
  request: MeetingRequest
  participants: PartyRules[]      // D13: min 2, max 50 (A-10)
  options: Options
}

type MeetingRequest = {
  date: LocalDate                 // the date of `start`, in `timeZone`
  start: ClockTime
  end: ClockTime                  // end < start ⇒ ends the next day (C7 as amended by G23); end == start ⇒ INVALID_INPUT; "24:00" not allowed here
  timeZone: ZoneId                // the requester’s zone; all output slots are rendered in it
}

type PartyRules = {
  partyId: string                 // 1–64 chars, unique within `participants`
  timeZone: ZoneId
  weeklyRules: Partial<Record<DayName, Interval[]>>   // missing day ⇒ no availability that day
  blackouts?: LocalDate[]         // dates in THIS party’s zone (C6); default []
}

type Interval = {
  start: ClockTime
  end: EndTime                    // end < start ⇒ overnight wrap; end == start ⇒ INVALID_INTERVAL (C5)
}

type Options = {
  now: UtcInstant                 // required in core (C8)
  minNoticeMinutes?: number       // int 0–525600, default 0 (A-02: global, not per party)
  searchHorizonDays?: number      // int 1–90, default 14 (C9)
  searchStepMinutes?: number      // int 1–1440, default 15 (C9)
  maxSuggestions?: number         // int 1–10, default 3 (C9)
}
```

`NegotiationRequest` is what callers send: the optional fields above may be omitted. Parsing fills every default and yields `ResolvedNegotiationRequest`, the same shape with `blackouts` and all `options` required (G30). The engine works on the resolved form.

### 3.3 `NegotiationResult`

```ts
type NegotiationResult = NegotiationOk | ErrorResult

type NegotiationOk = {
  ok: true
  decision: "book" | "counter_offer"
  requested: IsoSlot              // the request as parsed, in UTC and in the requester zone
  slots: IsoSlot[]                // see §4.7; rank order, NOT chronological
  reasons: Reason[]               // [] for a clean book; see §3.5
}

type IsoSlot = {
  start: IsoOffset                // in request.timeZone
  end: IsoOffset
  startUtc: UtcInstant
  endUtc: UtcInstant
}

type Reason = {
  code: ReasonCode
  participantId?: string          // absent for global reasons
  message: string                 // exact templates in §3.5
}
```

* `evaluate()` ⇒ `slots = [requested]` on `book`; up to `maxSuggestions` ranked alternatives on `counter_offer` (possibly `[]`).
* `suggest()` returns the same shape; `slots` always holds ranked alternatives (on a `book`, the requested slot itself is first, being at distance 0). Slots never overlap one another (G22, §4.7).
* A `book` has `reasons: []` unless `DST_RULE_ADJUSTED` notes apply (§4.3).
* There is **no** `needs_clarification` decision. An ambiguous zone is an `ErrorResult` with exit code 3 (D14, A-04).
* `IsoSlot` carries no per-participant local views in v0.1.0; consumers convert from UTC (A-09).

### 3.4 `ErrorResult` and `ErrorCode`

```ts
type ErrorResult = {
  ok: false
  error: { code: ErrorCode; message: string; details?: Record<string, unknown> }
}
```

| `ErrorCode` | CLI exit | When | `details` |
|---|---|---|---|
| `INVALID_INPUT` | 2 | schema/format/bounds violation; fewer than 2 participants; duplicate `partyId`; request `start == end` (G23); unreadable file or bad JSON (CLI) | `issues: [{ path, message }]` |
| `INVALID_ZONE` | 2 | zone string is not an IANA id and not in the abbreviation table | `field`, `value` |
| `AMBIGUOUS_ZONE` | **3** | zone string is in the abbreviation table (C11) | `field`, `value`, `options: ZoneId[]` |
| `INVALID_INTERVAL` | 2 | availability rule with `start == end` (C5) | `field`, `start`, `end` |
| `DST_NONEXISTENT_LOCAL_TIME` | 2 | request `start` or `end` falls in a spring-forward gap (C10) | `field`, `localTime`, `timeZone`, `transitionUtc`, `offsetBefore`, `offsetAfter` |
| `DST_AMBIGUOUS_LOCAL_TIME` | 2 | request `start` or `end` falls in a fall-back overlap (C10) | `field`, `localTime`, `timeZone`, `candidates: [{ utc, offset }]` |
| `INTERNAL_ERROR` | 4 (A-12) | a bug; only the CLI wrapper produces this, core never throws | — |

DST errors are input errors rather than a `counter_offer` because ranking (C9) needs a requested start instant, and a nonexistent or ambiguous wall time has none (A-05).

### 3.5 `ReasonCode`

| `ReasonCode` | Scope | Meaning | Message template (exact) |
|---|---|---|---|
| `OK` | check only | the participant/gate passed (used in `explain`, never in `reasons`) | — |
| `IN_PAST` | global | `requested.start < now` (C8) | `Requested start {startUtc} is before now {now}.` |
| `INSUFFICIENT_NOTICE` | global | `now <= requested.start < now + minNoticeMinutes` | `Requested start {startUtc} is earlier than now plus {minNoticeMinutes} minutes ({bound}).` |
| `OUTSIDE_AVAILABILITY` | participant | the requested interval is not inside the participant’s merged intervals | `{partyId}: requested interval is not inside any availability interval.` |
| `IN_BLACKOUT` | participant | the interval *would* be inside the merged intervals if blackouts were ignored (C6) | `{partyId}: availability is blocked by blackout date {date}.` |
| `NO_SLOTS_IN_HORIZON` | global | `counter_offer` and the search found nothing | `No slot found within {searchHorizonDays} days of the requested start.` |
| `DST_RULE_ADJUSTED` | participant | informational: an availability rule boundary overlapping the request fell in a gap/overlap and was resolved (A-07) | `{partyId}: rule boundary {localTime} in {timeZone} is {nonexistent\|ambiguous}; resolved to {utc}.` |

Placeholders: `{startUtc}`, `{now}`, `{bound}` are `UtcInstant`; `{date}` is the `ownerDate` of the earliest blocked instance overlapping the request; `{localTime}` is `YYYY-MM-DDTHH:mm`.

**Ordering of `reasons`** (A-11, needed for participant-swap symmetry): global reasons first in this order — `IN_PAST` | `INSUFFICIENT_NOTICE`; then, per participant sorted by `partyId` ascending (code-unit order), that participant’s failure reason (`IN_BLACKOUT` | `OUTSIDE_AVAILABILITY`) followed by its `DST_RULE_ADJUSTED` notes in chronological order; finally `NO_SLOTS_IN_HORIZON`. Per participant, at most one failure reason.

### 3.6 `ExplainResult` (D15)

```ts
type ExplainResult = ErrorResult | {
  ok: true
  decision: "book" | "counter_offer"
  reasons: Reason[]               // identical to evaluate()
  requested: CandidateTrace
  candidates: CandidateTrace[]    // exactly the slots evaluate() would return on a counter_offer, in rank order; [] on book (A-18)
}

type CandidateTrace = {
  slot: IsoSlot
  pass: boolean                   // timeGate === "OK" && every check passed
  timeGate: "OK" | "IN_PAST" | "INSUFFICIENT_NOTICE"
  checks: ParticipantCheck[]      // one per participant, sorted by `participant` ascending
}

type ParticipantCheck = {
  participant: string             // partyId
  ruleMatched: RuleRef | null     // the availability instance containing the slot start; null when pass is false
  pass: boolean
  reasonCode: "OK" | "OUTSIDE_AVAILABILITY" | "IN_BLACKOUT"   // stable enum
}

type RuleRef = { weekday: DayName; start: ClockTime; end: EndTime; ownerDate: LocalDate }
```

`ruleMatched` is the non-blacked-out rule instance with `instance.start <= slot.start <= instance.end` that starts earliest.

---

## 4. Semantics

### 4.1 Validation order (first failure wins)

1. **Schema** (Zod): shapes, formats, bounds, ≥ 2 participants, unique `partyId`, request `start` ≠ `end` (G23) → `INVALID_INPUT`.
2. **Zones**: `request.timeZone`, then `participants[0..n].timeZone` in array order → `AMBIGUOUS_ZONE` or `INVALID_ZONE`. Zones are validated **before** Luxon sees them, because Luxon accepts `IST`, `EST`, `PST`… as valid zones and would silently resolve them (C11).
3. **Intervals**: participants in array order, weekdays Monday→Sunday, intervals in array order → `INVALID_INTERVAL`.
4. **Request wall times**: `start`, then `end` → `DST_NONEXISTENT_LOCAL_TIME` or `DST_AMBIGUOUS_LOCAL_TIME`.

### 4.2 Wall-clock time → instant

For a zone, a date and a `HH:mm`, the set of instants whose local reading equals that wall time has **one** element (normal), **zero** (spring-forward gap: *nonexistent*) or **two** (fall-back overlap: *ambiguous*). Detection uses a Luxon round-trip check, because Luxon alone silently shifts gaps forward and resolves overlaps to one offset (C10). Request times follow §4.1 step 4. Availability-rule boundaries follow §4.3.

### 4.3 Availability instances (C5, C6)

For participant *P*, each local date *D* in *P.timeZone* with weekday *W*, and each rule *r* in `weeklyRules[W]`, one **instance** is produced:

| `r.end` | instance start | instance end |
|---|---|---|
| `> r.start` | `D@r.start` | `D@r.end` |
| `< r.start` (overnight) | `D@r.start` | `(D+1)@r.end` |
| `"24:00"` | `D@r.start` | `(D+1)@00:00` |

* **Ownership (C5):** the instance is owned by *D*, the day it **starts**, whatever days it touches. Monday 20:00–06:00 covers Tuesday 00:00–06:00 only through Monday’s rule.
* Both boundaries are converted with the IANA zone, so an instance’s real length can differ from its nominal length across DST (EX-14, EX-15, EX-16).
* **Rule-boundary policy (A-07, G34):** a nonexistent boundary, start **or** end, resolves to the **transition instant** (the first instant after the gap); an ambiguous boundary resolves to the **earlier** occurrence. An instance with `end <= start` after resolving (a rule wholly inside the gap) is dropped with no reason. If an adjusted instance overlaps the requested interval, a `DST_RULE_ADJUSTED` reason is emitted.
* **Blackouts (C6):** a blackout date is read in *P*’s own zone and removes every instance **owned by** that date, including any part after midnight. An instance that started the day before is unaffected.
* **Merge:** remaining instances are merged per participant; instances that overlap **or touch** (`next.start <= current.end`) join. Intervals are **closed** (A-16).
* **Containment:** an interval `[s, e]` is available for *P* iff it lies inside one merged interval (`m.start <= s && e <= m.end`).
* Expansion covers every local date from two days before the earliest instant considered to one day after the latest.

### 4.4 The requested interval (C7)

`start = date@request.start` in `request.timeZone`. `request.end == request.start` is rejected in the schema step (`INVALID_INPUT`, G23, EX-10). Otherwise `end = date@request.end` if `request.end > request.start`, else `(date+1)@request.end` (so `end < start` crosses midnight, and `end: "00:00"` means the next midnight). The nominal duration is therefore in (0, 24 h); across a DST change the real duration can differ from the nominal one by the transition delta, and the real duration is the one used everywhere (*Δ*).

### 4.5 Time gates (C8)

`now` is an ISO-8601 UTC string and the only clock. Let `bound = now + minNoticeMinutes`.

* `requested.start < now` → `IN_PAST`.
* else `requested.start < bound` → `INSUFFICIENT_NOTICE`.
* `requested.start == now` and `requested.start == bound` pass.
* A request that fails a gate is always a `counter_offer`. DST context never depends on `now`.

### 4.6 Decision

`book` iff the time gate passes **and** the requested interval is available for **every** participant. Otherwise `counter_offer`, with the reasons of §3.5. Per participant: if the interval is contained in the merged intervals **computed without removing blackouts** but not in the merged intervals **with** blackouts removed, the reason is `IN_BLACKOUT`; any other failure is `OUTSIDE_AVAILABILITY`.

### 4.7 Counter-offer search (C9)

With *H* = `searchHorizonDays`, *step* = `searchStepMinutes`, *Δ* the request duration, *rs* the requested start:

* **Candidate lattice (A-06):** `s_k = rs + k × step` for every integer *k*, with `|s_k − rs| ≤ H × 24 h` and `s_k >= bound`. Steps are absolute minutes, not wall-clock.
* A candidate `[s_k, s_k + Δ]` **fits** iff it is available for every participant (§4.3).
* **Rank:** ascending `|s_k − rs|`; ties → earlier `s_k` first.
* **Select greedily, without overlap (G22):** walk the ranked fitting candidates in order; skip a candidate that **overlaps** any slot already picked; stop at `maxSuggestions`. Two slots overlap iff each starts strictly before the other ends, so slots that merely touch (one ends exactly when the next starts) do not overlap (A-27). A skipped candidate is never revisited, and the result may hold fewer than `maxSuggestions` slots when the horizon runs out.
* If the decision is `counter_offer` and nothing fits, `slots` is `[]` and `NO_SLOTS_IN_HORIZON` is appended.

### 4.8 Determinism

No iteration order depends on hash order or input order: participants are processed sorted by `partyId`, reasons follow §3.5, candidates follow §4.7. Equal input (including `now`) yields byte-identical JSON.

### 4.9 Rendering

* `startUtc` / `endUtc`: `YYYY-MM-DDTHH:mm:ssZ`.
* `start` / `end`: Luxon `toISO({ suppressMilliseconds: true })` in `request.timeZone`: numeric offset (`-05:00`, `+00:00` for Europe/London in winter); the zones `UTC` and `GMT` render `Z`.
* JSON keys in the order shown in this document.

---

## 5. CLI contract (public API)

```
tempo check   [file]    # evaluate()  → book | counter_offer
tempo suggest [file]    # suggest()   → ranked alternatives
tempo explain [file]    # explain()   → per-candidate, per-participant trace
```

* **Input:** a JSON `NegotiationRequest` from `[file]`, or from stdin when `[file]` is omitted or `-`. UTF-8; a leading BOM is stripped (Windows PowerShell 5.1 writes one). No interactive prompts, ever.
* **`now`:** `--now <UtcInstant>` overrides `options.now` in the file, which overrides the real clock. Only the CLI reads the clock (A-13).
* **Output:** human-readable text by default; `--json` prints the result object on stdout (an `ErrorResult` too). Without `--json`, errors go to stderr as one human-readable line.
* **Exit codes (D14):**

| Code | Meaning |
|---|---|
| `0` | computation succeeded, whatever the decision |
| `1` | with `--exit-code` only: decision is `counter_offer` (with `--exit-code`, `book` stays `0`) |
| `2` | input error (`INVALID_INPUT`, `INVALID_ZONE`, `INVALID_INTERVAL`, `DST_*_LOCAL_TIME`) |
| `3` | ambiguous zone (`AMBIGUOUS_ZONE`) |
| `4` | internal error (`INTERNAL_ERROR`; G24) |

`--exit-code` never changes the output, only the exit status, and only for successful computations.

---

## 6. Worked examples

### 6.0 Conventions

* The notation `monday–friday 09:00–17:00` means the same interval under each of those `weeklyRules` keys. The JSON form for EX-01 is:
  `"weeklyRules": { "monday": [{ "start": "09:00", "end": "17:00" }], "tuesday": [{ "start": "09:00", "end": "17:00" }], … "friday": […] }`.
* Counter-offer `slots` are picked greedily without overlap (G22, §4.7); in these examples all slots start on the 15-minute lattice.
* Unspecified `options` are at their defaults: `minNoticeMinutes 0`, `searchHorizonDays 14`, `searchStepMinutes 15`, `maxSuggestions 3`. `blackouts` default to none.
* Offsets in parentheses are the UTC offsets used for that local instant. `Z` times are UTC. Intervals are closed.
* Every conversion was computed from the IANA database through Luxon 3.7.2 in a throwaway script (not in the repo) **and** hand-checked against the transition dates quoted in each example.
* Each example becomes a table-driven test (`EX-nn`) and an exported fixture; see `TEST_PLAN.md` §2 and §9.
* Outputs are shown for `evaluate()` unless stated. Dates: 2025-01-06 is a Monday; 2025-03-09, 2025-03-30, 2025-04-06, 2025-10-05 and 2025-11-02 are Sundays.

### 6.1 Index

| ID | Title | Result | Covers |
|---|---|---|---|
| EX-01 | Same-day book, winter offsets | `book` | basic containment; New York EST (−05:00) vs London GMT (+00:00) |
| EX-02 | Request longer than the overlap (the old Example 1) | `counter_offer` (0 slots) | correction of the old Example 1; `NO_SLOTS_IN_HORIZON`; empty `slots` |
| EX-03 | Summer offsets (the old Example 3) | `book` | New York EDT (−04:00) vs London BST (+01:00); correction of the old Example 3 ("EST in June") |
| EX-04 | Blackout day → counter_offer (the old Example 4) | `counter_offer` (3 slots) | C6 blackout in the participant’s own zone; C8/C9 counter-offer instead of an error; `IN_BLACKOUT` |
| EX-05 | Overnight shift, request in the wrapped part (start-day ownership) | `book` | C5 overnight wrap; the shift belongs to the day it STARTS on |
| EX-06 | Same rule, request on the wrong owner day | `counter_offer` (3 slots) | C5: Monday 02:00 belongs to Sunday’s shift, and bob has no Sunday rule |
| EX-07 | End 24:00 and adjacent-interval merge | `book` | C5: `end: "24:00"` is allowed; touching intervals merge, so a request can span the join |
| EX-08 | Request crossing midnight | `book` | C7: `end <= start` means the request ends the next day; merge across midnight |
| EX-09 | Rule with start == end is rejected | `INVALID_INTERVAL` (exit 2) | C5 validation error `INVALID_INTERVAL`; D13 core never throws |
| EX-10 | Request with start == end is rejected | `INVALID_INPUT` (exit 2) | G23 (V1): a likely typo is an error, not a 24-hour meeting; amends C7 to `end < start` ⇒ next day |
| EX-11 | US spring-forward day (the old Example 2) | `counter_offer` (0 slots) | correction of the old Example 2: 2025-03-09 New York is EDT (−04:00) after 02:00; Sydney is still AEDT (+11:00) |
| EX-12 | US spring-forward gap: nonexistent local time | `DST_NONEXISTENT_LOCAL_TIME` (exit 2) | C10: 02:30 does not exist on 2025-03-09 in America/New_York → rejected with a DST reason |
| EX-13 | US fall-back: ambiguous local time | `DST_AMBIGUOUS_LOCAL_TIME` (exit 2) | C10: 01:30 occurs twice on 2025-11-02 in America/New_York → rejected, both readings reported |
| EX-14 | EU spring-forward inside an overnight shift | `book` | midnight wrap across a DST change; Europe/Berlin 2025-03-30 (CET +01:00 → CEST +02:00); the 8-hour nominal shift lasts 7 real hours |
| EX-15 | Australia/Sydney fall-back inside an overnight shift | `book` | southern-hemisphere DST end 2025-04-06 (AEDT +11:00 → AEST +10:00); the nominal 8-hour shift lasts 9 real hours |
| EX-16 | Australia/Lord_Howe: the 30-minute DST shift | `book` | E18: Lord_Howe goes +10:30 → +11:00 at 02:00 on 2025-10-05; 02:30 is the first valid local time after the gap |
| EX-17 | Half-hour and 45-minute offsets (+05:30, +05:45) | `counter_offer` (3 slots) | E18: Asia/Kolkata (+05:30) and Asia/Kathmandu (+05:45); counter-offer ranked by distance |
| EX-18 | Blackout blocks an overnight shift that starts on it | `counter_offer` (3 slots) | C6: the blackout date blocks every interval that STARTS on that date, including the part after midnight |
| EX-19 | Request before now | `counter_offer` (3 slots) | C8: request starting before `now` → counter_offer with `IN_PAST`; candidates start at or after `now` |
| EX-20 | minNoticeMinutes | `counter_offer` (3 slots) | C8: `minNoticeMinutes` raises the lower bound to now + notice; `INSUFFICIENT_NOTICE` |
| EX-21 | Counter-offer ranking and tie-break | `counter_offer` (3 slots) | C9: rank by absolute distance from the requested start; ties → earlier first; output is rank order, not chronological |
| EX-22 | Three participants, with the explain trace | `counter_offer` (3 slots) | D13 (N participants); D15 `ExplainResult`; ruleMatched/reasonCode per participant per candidate |
| EX-23 | Ambiguous abbreviation "IST" | `AMBIGUOUS_ZONE` (exit 3) | C11: zone validation happens before Luxon; `IST` → `AMBIGUOUS_ZONE`, exit 3, with candidates |
| EX-24 | Rule boundary inside a DST gap | `book` | rule-boundary policy A-07: a nonexistent rule boundary resolves to the transition instant and emits `DST_RULE_ADJUSTED` |

---

### EX-01 — Same-day book, winter offsets

**Covers:** basic containment; New York EST (−05:00) vs London GMT (+00:00)

**Input**

- request: `2025-01-06` `09:30`→`10:30` in `America/New_York`
- `alice` — `America/New_York` — weeklyRules: monday–friday 09:00–17:00
- `bob` — `Europe/London` — weeklyRules: monday–friday 09:00–17:00
- options: now=`2025-01-03T12:00:00Z` (other options at defaults)

**Local → UTC expansion**

- request: 2025-01-06 09:30 (-05:00) → 2025-01-06 10:30 (-05:00) = `[2025-01-06T14:30:00Z, 2025-01-06T15:30:00Z]` (1 h)
- `alice` (`America/New_York`):
  - owner 2025-01-06 monday 09:00–17:00: 2025-01-06 09:00 (-05:00) → 2025-01-06 17:00 (-05:00) = `[2025-01-06T14:00:00Z, 2025-01-06T22:00:00Z]`
  - owner 2025-01-07 tuesday 09:00–17:00: 2025-01-07 09:00 (-05:00) → 2025-01-07 17:00 (-05:00) = `[2025-01-07T14:00:00Z, 2025-01-07T22:00:00Z]`
- `bob` (`Europe/London`):
  - owner 2025-01-06 monday 09:00–17:00: 2025-01-06 09:00 (+00:00) → 2025-01-06 17:00 (+00:00) = `[2025-01-06T09:00:00Z, 2025-01-06T17:00:00Z]`
  - owner 2025-01-07 tuesday 09:00–17:00: 2025-01-07 09:00 (+00:00) → 2025-01-07 17:00 (+00:00) = `[2025-01-07T09:00:00Z, 2025-01-07T17:00:00Z]`

**Merged availability** (blackouts removed, touching/overlapping instances merged; computed over the expanded search range, so a continuous run is cut at the range ends)

- `alice`: `[2025-01-06T14:00:00Z, 2025-01-06T22:00:00Z]`, `[2025-01-07T14:00:00Z, 2025-01-07T22:00:00Z]`
- `bob`: `[2025-01-06T09:00:00Z, 2025-01-06T17:00:00Z]`, `[2025-01-07T09:00:00Z, 2025-01-07T17:00:00Z]`

**Evaluation**

`alice` `[14:00Z, 22:00Z]` ⊇ request ✔. `bob` `[09:00Z, 17:00Z]` ⊇ request ✔. → `book`, `slots` = the requested slot. (The two windows overlap on `[14:00Z, 17:00Z]`.)

**Output** (`evaluate`)

```json
{
  "ok": true,
  "decision": "book",
  "requested": { "start": "2025-01-06T09:30:00-05:00", "end": "2025-01-06T10:30:00-05:00", "startUtc": "2025-01-06T14:30:00Z", "endUtc": "2025-01-06T15:30:00Z" },
  "slots": [{ "start": "2025-01-06T09:30:00-05:00", "end": "2025-01-06T10:30:00-05:00", "startUtc": "2025-01-06T14:30:00Z", "endUtc": "2025-01-06T15:30:00Z" }],
  "reasons": []
}
```

**CLI exit code:** `0` (with or without `--exit-code`)

---

### EX-02 — Request longer than the overlap (the old Example 1)

**Covers:** correction of the old Example 1; `NO_SLOTS_IN_HORIZON`; empty `slots`

**Input**

- request: `2025-01-06` `14:00`→`19:00` in `UTC`
- `alice` — `America/New_York` — weeklyRules: monday–friday 09:00–17:00
- `bob` — `Europe/London` — weeklyRules: monday–friday 09:00–17:00
- options: now=`2025-01-03T12:00:00Z` (other options at defaults)

**Local → UTC expansion**

- request: 2025-01-06 14:00 (+00:00) → 2025-01-06 19:00 (+00:00) = `[2025-01-06T14:00:00Z, 2025-01-06T19:00:00Z]` (5 h)
- `alice` (`America/New_York`):
  - owner 2025-01-06 monday 09:00–17:00: 2025-01-06 09:00 (-05:00) → 2025-01-06 17:00 (-05:00) = `[2025-01-06T14:00:00Z, 2025-01-06T22:00:00Z]`
  - owner 2025-01-07 tuesday 09:00–17:00: 2025-01-07 09:00 (-05:00) → 2025-01-07 17:00 (-05:00) = `[2025-01-07T14:00:00Z, 2025-01-07T22:00:00Z]`
- `bob` (`Europe/London`):
  - owner 2025-01-06 monday 09:00–17:00: 2025-01-06 09:00 (+00:00) → 2025-01-06 17:00 (+00:00) = `[2025-01-06T09:00:00Z, 2025-01-06T17:00:00Z]`
  - owner 2025-01-07 tuesday 09:00–17:00: 2025-01-07 09:00 (+00:00) → 2025-01-07 17:00 (+00:00) = `[2025-01-07T09:00:00Z, 2025-01-07T17:00:00Z]`

**Merged availability** (blackouts removed, touching/overlapping instances merged; computed over the expanded search range, so a continuous run is cut at the range ends)

- `alice`: `[2025-01-06T14:00:00Z, 2025-01-06T22:00:00Z]`, `[2025-01-07T14:00:00Z, 2025-01-07T22:00:00Z]`
- `bob`: `[2025-01-06T09:00:00Z, 2025-01-06T17:00:00Z]`, `[2025-01-07T09:00:00Z, 2025-01-07T17:00:00Z]`

**Evaluation**

`alice` `[14:00Z, 22:00Z]` ⊇ request ✔. `bob` ends at `17:00Z` but the request runs to `19:00Z` ✘ → `OUTSIDE_AVAILABILITY`. The daily overlap is only 3 h (`14:00Z–17:00Z`), shorter than the 5 h request, so no candidate exists in ±14 days → `slots: []` + `NO_SLOTS_IN_HORIZON`.

> **Old SPEC error fixed:** the old Example 1 requested `14:00Z–19:00Z`, which runs past London’s 17:00 GMT (= 17:00Z), so it could not be `book`.

**Output** (`evaluate`)

```json
{
  "ok": true,
  "decision": "counter_offer",
  "requested": { "start": "2025-01-06T14:00:00Z", "end": "2025-01-06T19:00:00Z", "startUtc": "2025-01-06T14:00:00Z", "endUtc": "2025-01-06T19:00:00Z" },
  "slots": [],
  "reasons": [
    { "code": "OUTSIDE_AVAILABILITY", "participantId": "bob", "message": "bob: requested interval is not inside any availability interval." },
    { "code": "NO_SLOTS_IN_HORIZON", "message": "No slot found within 14 days of the requested start." }
  ]
}
```

**CLI exit code:** `0`; `1` with `--exit-code`

---

### EX-03 — Summer offsets (the old Example 3)

**Covers:** New York EDT (−04:00) vs London BST (+01:00); correction of the old Example 3 ("EST in June")

**Input**

- request: `2025-06-02` `09:00`→`10:00` in `America/New_York`
- `alice` — `America/New_York` — weeklyRules: monday–friday 09:00–17:00
- `bob` — `Europe/London` — weeklyRules: monday–friday 14:00–22:00
- options: now=`2025-05-30T12:00:00Z` (other options at defaults)

**Local → UTC expansion**

- request: 2025-06-02 09:00 (-04:00) → 2025-06-02 10:00 (-04:00) = `[2025-06-02T13:00:00Z, 2025-06-02T14:00:00Z]` (1 h)
- `alice` (`America/New_York`):
  - owner 2025-06-02 monday 09:00–17:00: 2025-06-02 09:00 (-04:00) → 2025-06-02 17:00 (-04:00) = `[2025-06-02T13:00:00Z, 2025-06-02T21:00:00Z]`
  - owner 2025-06-03 tuesday 09:00–17:00: 2025-06-03 09:00 (-04:00) → 2025-06-03 17:00 (-04:00) = `[2025-06-03T13:00:00Z, 2025-06-03T21:00:00Z]`
- `bob` (`Europe/London`):
  - owner 2025-06-02 monday 14:00–22:00: 2025-06-02 14:00 (+01:00) → 2025-06-02 22:00 (+01:00) = `[2025-06-02T13:00:00Z, 2025-06-02T21:00:00Z]`
  - owner 2025-06-03 tuesday 14:00–22:00: 2025-06-03 14:00 (+01:00) → 2025-06-03 22:00 (+01:00) = `[2025-06-03T13:00:00Z, 2025-06-03T21:00:00Z]`

**Merged availability** (blackouts removed, touching/overlapping instances merged; computed over the expanded search range, so a continuous run is cut at the range ends)

- `alice`: `[2025-06-02T13:00:00Z, 2025-06-02T21:00:00Z]`, `[2025-06-03T13:00:00Z, 2025-06-03T21:00:00Z]`
- `bob`: `[2025-06-02T13:00:00Z, 2025-06-02T21:00:00Z]`, `[2025-06-03T13:00:00Z, 2025-06-03T21:00:00Z]`

**Evaluation**

`alice` 09:00–17:00 EDT (−04:00) = `[13:00Z, 21:00Z]`. `bob` 14:00–22:00 BST (+01:00) = `[13:00Z, 21:00Z]`. The windows are identical; the request `[13:00Z, 14:00Z]` fits both → `book`.

> **Old SPEC error fixed:** the old Example 3 labelled June offsets “EST” and claimed “no overlap”. June in New York is EDT (−04:00), and with London on BST (+01:00) the two windows coincide exactly.

**Output** (`evaluate`)

```json
{
  "ok": true,
  "decision": "book",
  "requested": { "start": "2025-06-02T09:00:00-04:00", "end": "2025-06-02T10:00:00-04:00", "startUtc": "2025-06-02T13:00:00Z", "endUtc": "2025-06-02T14:00:00Z" },
  "slots": [{ "start": "2025-06-02T09:00:00-04:00", "end": "2025-06-02T10:00:00-04:00", "startUtc": "2025-06-02T13:00:00Z", "endUtc": "2025-06-02T14:00:00Z" }],
  "reasons": []
}
```

**CLI exit code:** `0` (with or without `--exit-code`)

---

### EX-04 — Blackout day → counter_offer (the old Example 4)

**Covers:** C6 blackout in the participant’s own zone; C8/C9 counter-offer instead of an error; `IN_BLACKOUT`

**Input**

- request: `2025-08-11` `10:00`→`11:00` in `America/New_York`
- `alice` — `America/New_York` — weeklyRules: monday–friday 09:00–17:00 — blackouts: 2025-08-11
- `bob` — `Europe/London` — weeklyRules: monday–friday 09:00–17:00
- options: now=`2025-08-08T12:00:00Z` (other options at defaults)

**Local → UTC expansion**

- request: 2025-08-11 10:00 (-04:00) → 2025-08-11 11:00 (-04:00) = `[2025-08-11T14:00:00Z, 2025-08-11T15:00:00Z]` (1 h)
- `alice` (`America/New_York`):
  - owner 2025-08-11 monday 09:00–17:00: 2025-08-11 09:00 (-04:00) → 2025-08-11 17:00 (-04:00) = `[2025-08-11T13:00:00Z, 2025-08-11T21:00:00Z]` — **blocked by blackout (C6)**
  - owner 2025-08-12 tuesday 09:00–17:00: 2025-08-12 09:00 (-04:00) → 2025-08-12 17:00 (-04:00) = `[2025-08-12T13:00:00Z, 2025-08-12T21:00:00Z]`
- `bob` (`Europe/London`):
  - owner 2025-08-11 monday 09:00–17:00: 2025-08-11 09:00 (+01:00) → 2025-08-11 17:00 (+01:00) = `[2025-08-11T08:00:00Z, 2025-08-11T16:00:00Z]`
  - owner 2025-08-12 tuesday 09:00–17:00: 2025-08-12 09:00 (+01:00) → 2025-08-12 17:00 (+01:00) = `[2025-08-12T08:00:00Z, 2025-08-12T16:00:00Z]`

**Merged availability** (blackouts removed, touching/overlapping instances merged; computed over the expanded search range, so a continuous run is cut at the range ends)

- `alice`: `[2025-08-12T13:00:00Z, 2025-08-12T21:00:00Z]`
- `bob`: `[2025-08-11T08:00:00Z, 2025-08-11T16:00:00Z]`, `[2025-08-12T08:00:00Z, 2025-08-12T16:00:00Z]`

**Evaluation**

Request `[14:00Z, 15:00Z]`. `bob` `[08:00Z, 16:00Z]` ⊇ request ✔. `alice`’s only Monday instance starts on the blackout date `2025-08-11`, so it is removed before merging (C6) → nothing contains the request. Because the request *would* be contained if the blackout were ignored, the reason is `IN_BLACKOUT` (not `OUTSIDE_AVAILABILITY`). The next unblocked day is Tuesday `2025-08-12`, where both windows overlap on `[13:00Z, 16:00Z]`. Fitting starts ranked by distance: 13:00Z (23 h), 13:15Z, 13:30Z, … Greedy non-overlap (G22) picks 13:00Z, skips 13:15Z–13:45Z (each overlaps the pick), then takes 14:00Z (24 h) and 15:00Z (25 h; the slot ends at 16:00Z exactly when `bob`’s window ends, which is allowed, A-16). The last Friday option (`2025-08-08T15:00Z`) is 71 h away and is never reached.

> **Old SPEC error fixed:** the old Example 4 returned an `error` for a blackout and labelled August “EST”. Per C6/C8/C9 a blackout is a `counter_offer` with a reason; August in New York is EDT (−04:00).

**Output** (`evaluate`)

```json
{
  "ok": true,
  "decision": "counter_offer",
  "requested": { "start": "2025-08-11T10:00:00-04:00", "end": "2025-08-11T11:00:00-04:00", "startUtc": "2025-08-11T14:00:00Z", "endUtc": "2025-08-11T15:00:00Z" },
  "slots": [
    { "start": "2025-08-12T09:00:00-04:00", "end": "2025-08-12T10:00:00-04:00", "startUtc": "2025-08-12T13:00:00Z", "endUtc": "2025-08-12T14:00:00Z" },
    { "start": "2025-08-12T10:00:00-04:00", "end": "2025-08-12T11:00:00-04:00", "startUtc": "2025-08-12T14:00:00Z", "endUtc": "2025-08-12T15:00:00Z" },
    { "start": "2025-08-12T11:00:00-04:00", "end": "2025-08-12T12:00:00-04:00", "startUtc": "2025-08-12T15:00:00Z", "endUtc": "2025-08-12T16:00:00Z" }
  ],
  "reasons": [{ "code": "IN_BLACKOUT", "participantId": "alice", "message": "alice: availability is blocked by blackout date 2025-08-11." }]
}
```

**CLI exit code:** `0`; `1` with `--exit-code`

---

### EX-05 — Overnight shift, request in the wrapped part (start-day ownership)

**Covers:** C5 overnight wrap; the shift belongs to the day it STARTS on

**Input**

- request: `2025-01-14` `02:00`→`03:00` in `Asia/Manila`
- `alice` — `America/New_York` — weeklyRules: monday–sunday 00:00–24:00
- `bob` — `Asia/Manila` — weeklyRules: monday 20:00–06:00
- options: now=`2025-01-10T00:00:00Z` (other options at defaults)

**Local → UTC expansion**

- request: 2025-01-14 02:00 (+08:00) → 2025-01-14 03:00 (+08:00) = `[2025-01-13T18:00:00Z, 2025-01-13T19:00:00Z]` (1 h)
- `alice` (`America/New_York`):
  - owner 2025-01-12 sunday 00:00–24:00: 2025-01-12 00:00 (-05:00) → 2025-01-13 00:00 (-05:00) = `[2025-01-12T05:00:00Z, 2025-01-13T05:00:00Z]`
  - owner 2025-01-13 monday 00:00–24:00: 2025-01-13 00:00 (-05:00) → 2025-01-14 00:00 (-05:00) = `[2025-01-13T05:00:00Z, 2025-01-14T05:00:00Z]`
  - owner 2025-01-14 tuesday 00:00–24:00: 2025-01-14 00:00 (-05:00) → 2025-01-15 00:00 (-05:00) = `[2025-01-14T05:00:00Z, 2025-01-15T05:00:00Z]`
- `bob` (`Asia/Manila`):
  - owner 2025-01-13 monday 20:00–06:00: 2025-01-13 20:00 (+08:00) → 2025-01-14 06:00 (+08:00) = `[2025-01-13T12:00:00Z, 2025-01-13T22:00:00Z]`

**Merged availability** (blackouts removed, touching/overlapping instances merged; computed over the expanded search range, so a continuous run is cut at the range ends)

- `alice`: `[2024-12-26T05:00:00Z, 2025-01-31T05:00:00Z]`
- `bob`: `[2025-01-13T12:00:00Z, 2025-01-13T22:00:00Z]`

**Evaluation**

`bob`’s Monday shift is owned by Monday `2025-01-13` and runs to Tuesday 06:00 local = `[2025-01-13T12:00Z, 2025-01-13T22:00Z]`. The request (Tuesday 02:00–03:00 Manila) = `[18:00Z, 19:00Z]` lies inside it ✔. `alice`’s seven back-to-back 00:00–24:00 instances touch end-to-start and merge into one continuous interval ✔. → `book`.

The request’s calendar date is Tuesday, but the shift that covers it is owned by Monday (C5, start-day ownership). `ruleMatched.ownerDate` in `explain` shows `2025-01-13`.

**Output** (`evaluate`)

```json
{
  "ok": true,
  "decision": "book",
  "requested": { "start": "2025-01-14T02:00:00+08:00", "end": "2025-01-14T03:00:00+08:00", "startUtc": "2025-01-13T18:00:00Z", "endUtc": "2025-01-13T19:00:00Z" },
  "slots": [{ "start": "2025-01-14T02:00:00+08:00", "end": "2025-01-14T03:00:00+08:00", "startUtc": "2025-01-13T18:00:00Z", "endUtc": "2025-01-13T19:00:00Z" }],
  "reasons": []
}
```

**CLI exit code:** `0` (with or without `--exit-code`)

---

### EX-06 — Same rule, request on the wrong owner day

**Covers:** C5: Monday 02:00 belongs to Sunday’s shift, and bob has no Sunday rule

**Input**

- request: `2025-01-13` `02:00`→`03:00` in `Asia/Manila`
- `alice` — `America/New_York` — weeklyRules: monday–sunday 00:00–24:00
- `bob` — `Asia/Manila` — weeklyRules: monday 20:00–06:00
- options: now=`2025-01-10T00:00:00Z` (other options at defaults)

**Local → UTC expansion**

- request: 2025-01-13 02:00 (+08:00) → 2025-01-13 03:00 (+08:00) = `[2025-01-12T18:00:00Z, 2025-01-12T19:00:00Z]` (1 h)
- `alice` (`America/New_York`):
  - owner 2025-01-11 saturday 00:00–24:00: 2025-01-11 00:00 (-05:00) → 2025-01-12 00:00 (-05:00) = `[2025-01-11T05:00:00Z, 2025-01-12T05:00:00Z]`
  - owner 2025-01-12 sunday 00:00–24:00: 2025-01-12 00:00 (-05:00) → 2025-01-13 00:00 (-05:00) = `[2025-01-12T05:00:00Z, 2025-01-13T05:00:00Z]`
  - owner 2025-01-13 monday 00:00–24:00: 2025-01-13 00:00 (-05:00) → 2025-01-14 00:00 (-05:00) = `[2025-01-13T05:00:00Z, 2025-01-14T05:00:00Z]`
- `bob` (`Asia/Manila`):
  - owner 2025-01-13 monday 20:00–06:00: 2025-01-13 20:00 (+08:00) → 2025-01-14 06:00 (+08:00) = `[2025-01-13T12:00:00Z, 2025-01-13T22:00:00Z]`

**Merged availability** (blackouts removed, touching/overlapping instances merged; computed over the expanded search range, so a continuous run is cut at the range ends)

- `alice`: `[2024-12-25T05:00:00Z, 2025-01-30T05:00:00Z]`
- `bob`: `[2025-01-13T12:00:00Z, 2025-01-13T22:00:00Z]`

**Evaluation**

The request (Monday 02:00–03:00 Manila) = `[2025-01-12T18:00Z, 19:00Z]`. Under start-day ownership that time would belong to a **Sunday** shift, and `bob` has no Sunday rule; his Monday instance only starts at `2025-01-13T12:00Z` ✘. The nearest valid start is 18 h after the requested start (`12:00Z`); the previous valid shift (owner `2025-01-06`) ended on `2025-01-07T22:00Z`, almost 5 days earlier. Greedy non-overlap (G22) picks `12:00Z`, skips `12:15Z`–`12:45Z`, then takes `13:00Z` and `14:00Z`.

**Output** (`evaluate`)

```json
{
  "ok": true,
  "decision": "counter_offer",
  "requested": { "start": "2025-01-13T02:00:00+08:00", "end": "2025-01-13T03:00:00+08:00", "startUtc": "2025-01-12T18:00:00Z", "endUtc": "2025-01-12T19:00:00Z" },
  "slots": [
    { "start": "2025-01-13T20:00:00+08:00", "end": "2025-01-13T21:00:00+08:00", "startUtc": "2025-01-13T12:00:00Z", "endUtc": "2025-01-13T13:00:00Z" },
    { "start": "2025-01-13T21:00:00+08:00", "end": "2025-01-13T22:00:00+08:00", "startUtc": "2025-01-13T13:00:00Z", "endUtc": "2025-01-13T14:00:00Z" },
    { "start": "2025-01-13T22:00:00+08:00", "end": "2025-01-13T23:00:00+08:00", "startUtc": "2025-01-13T14:00:00Z", "endUtc": "2025-01-13T15:00:00Z" }
  ],
  "reasons": [{ "code": "OUTSIDE_AVAILABILITY", "participantId": "bob", "message": "bob: requested interval is not inside any availability interval." }]
}
```

**CLI exit code:** `0`; `1` with `--exit-code`

---

### EX-07 — End 24:00 and adjacent-interval merge

**Covers:** C5: `end: "24:00"` is allowed; touching intervals merge, so a request can span the join

**Input**

- request: `2025-01-13` `11:00`→`13:00` in `America/New_York`
- `alice` — `America/New_York` — weeklyRules: monday 09:00–12:00, 12:00–24:00
- `bob` — `UTC` — weeklyRules: monday 00:00–24:00
- options: now=`2025-01-10T00:00:00Z` (other options at defaults)

**Local → UTC expansion**

- request: 2025-01-13 11:00 (-05:00) → 2025-01-13 13:00 (-05:00) = `[2025-01-13T16:00:00Z, 2025-01-13T18:00:00Z]` (2 h)
- `alice` (`America/New_York`):
  - owner 2025-01-13 monday 09:00–12:00: 2025-01-13 09:00 (-05:00) → 2025-01-13 12:00 (-05:00) = `[2025-01-13T14:00:00Z, 2025-01-13T17:00:00Z]`
  - owner 2025-01-13 monday 12:00–24:00: 2025-01-13 12:00 (-05:00) → 2025-01-14 00:00 (-05:00) = `[2025-01-13T17:00:00Z, 2025-01-14T05:00:00Z]`
- `bob` (`UTC`):
  - owner 2025-01-13 monday 00:00–24:00: 2025-01-13 00:00 (+00:00) → 2025-01-14 00:00 (+00:00) = `[2025-01-13T00:00:00Z, 2025-01-14T00:00:00Z]`

**Merged availability** (blackouts removed, touching/overlapping instances merged; computed over the expanded search range, so a continuous run is cut at the range ends)

- `alice`: `[2025-01-13T14:00:00Z, 2025-01-14T05:00:00Z]`
- `bob`: `[2025-01-13T00:00:00Z, 2025-01-14T00:00:00Z]`

**Evaluation**

`alice`’s two Monday instances are `[14:00Z, 17:00Z]` (09:00–12:00 EST) and `[17:00Z, 05:00Z+1d]` (12:00–24:00 EST; 24:00 = Tuesday 00:00 EST = 05:00Z). They touch at `17:00Z`, so they merge into `[14:00Z, 2025-01-14T05:00Z]`. The request `[16:00Z, 18:00Z]` straddles the join; neither raw instance contains it, the merged interval does ✔. `bob` (UTC, 00:00–24:00) ⊇ request ✔. → `book`.

**Output** (`evaluate`)

```json
{
  "ok": true,
  "decision": "book",
  "requested": { "start": "2025-01-13T11:00:00-05:00", "end": "2025-01-13T13:00:00-05:00", "startUtc": "2025-01-13T16:00:00Z", "endUtc": "2025-01-13T18:00:00Z" },
  "slots": [{ "start": "2025-01-13T11:00:00-05:00", "end": "2025-01-13T13:00:00-05:00", "startUtc": "2025-01-13T16:00:00Z", "endUtc": "2025-01-13T18:00:00Z" }],
  "reasons": []
}
```

**CLI exit code:** `0` (with or without `--exit-code`)

---

### EX-08 — Request crossing midnight

**Covers:** C7: `end <= start` means the request ends the next day; merge across midnight

**Input**

- request: `2025-01-10` `23:00`→`01:00` in `America/New_York`
- `alice` — `America/New_York` — weeklyRules: friday 18:00–24:00; saturday 00:00–02:00
- `bob` — `UTC` — weeklyRules: friday–saturday 00:00–24:00
- options: now=`2025-01-09T00:00:00Z` (other options at defaults)

**Local → UTC expansion**

- request: 2025-01-10 23:00 (-05:00) → 2025-01-11 01:00 (-05:00) = `[2025-01-11T04:00:00Z, 2025-01-11T06:00:00Z]` (2 h)
- `alice` (`America/New_York`):
  - owner 2025-01-10 friday 18:00–24:00: 2025-01-10 18:00 (-05:00) → 2025-01-11 00:00 (-05:00) = `[2025-01-10T23:00:00Z, 2025-01-11T05:00:00Z]`
  - owner 2025-01-11 saturday 00:00–02:00: 2025-01-11 00:00 (-05:00) → 2025-01-11 02:00 (-05:00) = `[2025-01-11T05:00:00Z, 2025-01-11T07:00:00Z]`
- `bob` (`UTC`):
  - owner 2025-01-10 friday 00:00–24:00: 2025-01-10 00:00 (+00:00) → 2025-01-11 00:00 (+00:00) = `[2025-01-10T00:00:00Z, 2025-01-11T00:00:00Z]`
  - owner 2025-01-11 saturday 00:00–24:00: 2025-01-11 00:00 (+00:00) → 2025-01-12 00:00 (+00:00) = `[2025-01-11T00:00:00Z, 2025-01-12T00:00:00Z]`

**Merged availability** (blackouts removed, touching/overlapping instances merged; computed over the expanded search range, so a continuous run is cut at the range ends)

- `alice`: `[2025-01-10T23:00:00Z, 2025-01-11T07:00:00Z]`
- `bob`: `[2025-01-10T00:00:00Z, 2025-01-12T00:00:00Z]`

**Evaluation**

C7: `23:00 → 01:00` means the request ends the next day, so it is `[2025-01-11T04:00Z, 06:00Z]` (2 h). `alice`’s Friday instance `[Jan 10 23:00Z, Jan 11 05:00Z]` (18:00–24:00 EST) and Saturday instance `[Jan 11 05:00Z, 07:00Z]` (00:00–02:00 EST) touch at `05:00Z` and merge into `[23:00Z, 07:00Z]` ⊇ request ✔. `bob` ⊇ request ✔. → `book`.

**Output** (`evaluate`)

```json
{
  "ok": true,
  "decision": "book",
  "requested": { "start": "2025-01-10T23:00:00-05:00", "end": "2025-01-11T01:00:00-05:00", "startUtc": "2025-01-11T04:00:00Z", "endUtc": "2025-01-11T06:00:00Z" },
  "slots": [{ "start": "2025-01-10T23:00:00-05:00", "end": "2025-01-11T01:00:00-05:00", "startUtc": "2025-01-11T04:00:00Z", "endUtc": "2025-01-11T06:00:00Z" }],
  "reasons": []
}
```

**CLI exit code:** `0` (with or without `--exit-code`)

---

### EX-09 — Rule with start == end is rejected

**Covers:** C5 validation error `INVALID_INTERVAL`; D13 core never throws

**Input**

- request: `2025-01-06` `09:00`→`10:00` in `UTC`
- `alice` — `UTC` — weeklyRules: monday 09:00–17:00
- `bob` — `UTC` — weeklyRules: monday 09:00–09:00
- options: now=`2025-01-03T00:00:00Z` (other options at defaults)

**Output**

```json
{
  "ok": false,
  "error": {
    "code": "INVALID_INTERVAL",
    "message": "Availability interval start and end must differ.",
    "details": { "field": "participants[1].weeklyRules.monday[0]", "start": "09:00", "end": "09:00" }
  }
}
```

**CLI exit code:** `2`

---

### EX-10 — Request with start == end is rejected

**Covers:** G23 (V1): `start == end` on a request is `INVALID_INPUT`; amends C7 to `end < start` ⇒ next day

**Input**

- request: `2025-01-06` `09:00`→`09:00` in `Europe/London`
- `alice` — `Europe/London` — weeklyRules: monday–friday 09:00–17:00
- `bob` — `Europe/London` — weeklyRules: monday–friday 09:00–17:00
- options: now=`2025-01-03T00:00:00Z` (other options at defaults)

**Evaluation**

A request whose `start` equals its `end` is far more likely a typo than a request for a 24-hour meeting, so the schema step rejects it (§4.1 step 1) before any zone or availability work. A caller who really wants a meeting that ends at the same wall time the next day cannot express it; the longest expressible request is 23 h 59 min (A-28).

**Output** (`evaluate`)

```json
{
  "ok": false,
  "error": {
    "code": "INVALID_INPUT",
    "message": "Request start and end must differ.",
    "details": { "issues": [{ "path": "request.end", "message": "Request start and end must differ." }] }
  }
}
```

**CLI exit code:** `2`

---

### EX-11 — US spring-forward day (the old Example 2)

**Covers:** correction of the old Example 2: 2025-03-09 New York is EDT (−04:00) after 02:00; Sydney is still AEDT (+11:00)

**Input**

- request: `2025-03-09` `09:00`→`12:00` in `America/New_York`
- `alice` — `America/New_York` — weeklyRules: sunday 09:00–17:00
- `bob` — `Australia/Sydney` — weeklyRules: sunday 15:00–23:00
- options: now=`2025-03-01T00:00:00Z` (other options at defaults)

**Local → UTC expansion**

- request: 2025-03-09 09:00 (-04:00) → 2025-03-09 12:00 (-04:00) = `[2025-03-09T13:00:00Z, 2025-03-09T16:00:00Z]` (3 h)
- `alice` (`America/New_York`):
  - owner 2025-03-09 sunday 09:00–17:00: 2025-03-09 09:00 (-04:00) → 2025-03-09 17:00 (-04:00) = `[2025-03-09T13:00:00Z, 2025-03-09T21:00:00Z]`
- `bob` (`Australia/Sydney`):
  - owner 2025-03-09 sunday 15:00–23:00: 2025-03-09 15:00 (+11:00) → 2025-03-09 23:00 (+11:00) = `[2025-03-09T04:00:00Z, 2025-03-09T12:00:00Z]`

**Merged availability** (blackouts removed, touching/overlapping instances merged; computed over the expanded search range, so a continuous run is cut at the range ends)

- `alice`: `[2025-03-09T13:00:00Z, 2025-03-09T21:00:00Z]`
- `bob`: `[2025-03-09T04:00:00Z, 2025-03-09T12:00:00Z]`

**Evaluation**

On 2025-03-09 New York springs forward at 02:00 local, so 09:00 is **EDT (−04:00)**: `alice` = `[13:00Z, 21:00Z]`. Sydney is still on AEDT (+11:00) until 2025-04-06: `bob` 15:00–23:00 = `[04:00Z, 12:00Z]`. The request `[13:00Z, 16:00Z]` ⊆ `alice` ✔ but is outside `bob` ✘. The two windows do not intersect at all (1 h gap, 12:00Z → 13:00Z); the other Sundays within ±14 days (02-23, 03-02, 03-16, 03-23) do not overlap either (New York on EST before 03-09: `[14:00Z, 22:00Z]`). → `slots: []`.

> **Old SPEC error fixed:** the old Example 2 used EST (−05:00) and “UTC+11 = `04:00Z–22:00Z`”; the arithmetic was wrong and the claimed `book` impossible.

**Output** (`evaluate`)

```json
{
  "ok": true,
  "decision": "counter_offer",
  "requested": { "start": "2025-03-09T09:00:00-04:00", "end": "2025-03-09T12:00:00-04:00", "startUtc": "2025-03-09T13:00:00Z", "endUtc": "2025-03-09T16:00:00Z" },
  "slots": [],
  "reasons": [
    { "code": "OUTSIDE_AVAILABILITY", "participantId": "bob", "message": "bob: requested interval is not inside any availability interval." },
    { "code": "NO_SLOTS_IN_HORIZON", "message": "No slot found within 14 days of the requested start." }
  ]
}
```

**CLI exit code:** `0`; `1` with `--exit-code`

---

### EX-12 — US spring-forward gap: nonexistent local time

**Covers:** C10: 02:30 does not exist on 2025-03-09 in America/New_York → rejected with a DST reason

**Input**

- request: `2025-03-09` `02:30`→`03:30` in `America/New_York`
- `alice` — `America/New_York` — weeklyRules: sunday 00:00–24:00
- `bob` — `UTC` — weeklyRules: sunday 00:00–24:00
- options: now=`2025-03-01T00:00:00Z` (other options at defaults)

The transition is 02:00 EST → 03:00 EDT at `07:00Z`, so wall-clock times `02:00–02:59` do not exist. Luxon would silently move `02:30` to `03:30 EDT`; the round-trip check (`02:30` ≠ `03:30`) detects this and Tempo rejects (C10). `explain`/`check` return this `ErrorResult`; the exit code is `2` (input error). See assumption A-05 for why this is an error and not a `counter_offer`.

**Output**

```json
{
  "ok": false,
  "error": {
    "code": "DST_NONEXISTENT_LOCAL_TIME",
    "message": "2025-03-09T02:30 does not exist in America/New_York (clocks skip forward).",
    "details": { "field": "request.start", "localTime": "2025-03-09T02:30", "timeZone": "America/New_York", "transitionUtc": "2025-03-09T07:00:00Z", "offsetBefore": "-05:00", "offsetAfter": "-04:00" }
  }
}
```

**CLI exit code:** `2`

---

### EX-13 — US fall-back: ambiguous local time

**Covers:** C10: 01:30 occurs twice on 2025-11-02 in America/New_York → rejected, both readings reported

**Input**

- request: `2025-11-02` `01:30`→`02:30` in `America/New_York`
- `alice` — `America/New_York` — weeklyRules: sunday 00:00–24:00
- `bob` — `UTC` — weeklyRules: sunday 00:00–24:00
- options: now=`2025-10-25T00:00:00Z` (other options at defaults)

The transition is 02:00 EDT → 01:00 EST at `06:00Z`, so `01:00–01:59` happens twice: `05:30Z` (EDT, −04:00) and `06:30Z` (EST, −05:00). Tempo never picks one (C10); the caller must resubmit with an unambiguous time (e.g. `00:30` or `02:30`), or the agent asks the human which reading was meant. Note: Luxon alone would resolve this to `−05:00`.

**Output**

```json
{
  "ok": false,
  "error": {
    "code": "DST_AMBIGUOUS_LOCAL_TIME",
    "message": "2025-11-02T01:30 occurs twice in America/New_York (clocks fall back).",
    "details": {
      "field": "request.start",
      "localTime": "2025-11-02T01:30",
      "timeZone": "America/New_York",
      "candidates": [{ "utc": "2025-11-02T05:30:00Z", "offset": "-04:00" }, { "utc": "2025-11-02T06:30:00Z", "offset": "-05:00" }]
    }
  }
}
```

**CLI exit code:** `2`

---

### EX-14 — EU spring-forward inside an overnight shift

**Covers:** midnight wrap across a DST change; Europe/Berlin 2025-03-30 (CET +01:00 → CEST +02:00); the 8-hour nominal shift lasts 7 real hours

**Input**

- request: `2025-03-30` `04:00`→`05:00` in `Europe/Berlin`
- `alice` — `UTC` — weeklyRules: saturday–sunday 00:00–24:00
- `bob` — `Europe/Berlin` — weeklyRules: saturday 22:00–06:00
- options: now=`2025-03-25T00:00:00Z` (other options at defaults)

**Local → UTC expansion**

- request: 2025-03-30 04:00 (+02:00) → 2025-03-30 05:00 (+02:00) = `[2025-03-30T02:00:00Z, 2025-03-30T03:00:00Z]` (1 h)
- `alice` (`UTC`):
  - owner 2025-03-29 saturday 00:00–24:00: 2025-03-29 00:00 (+00:00) → 2025-03-30 00:00 (+00:00) = `[2025-03-29T00:00:00Z, 2025-03-30T00:00:00Z]`
  - owner 2025-03-30 sunday 00:00–24:00: 2025-03-30 00:00 (+00:00) → 2025-03-31 00:00 (+00:00) = `[2025-03-30T00:00:00Z, 2025-03-31T00:00:00Z]`
- `bob` (`Europe/Berlin`):
  - owner 2025-03-29 saturday 22:00–06:00: 2025-03-29 22:00 (+01:00) → 2025-03-30 06:00 (+02:00) = `[2025-03-29T21:00:00Z, 2025-03-30T04:00:00Z]`

**Merged availability** (blackouts removed, touching/overlapping instances merged; computed over the expanded search range, so a continuous run is cut at the range ends)

- `alice`: `[2025-03-29T00:00:00Z, 2025-03-31T00:00:00Z]`
- `bob`: `[2025-03-29T21:00:00Z, 2025-03-30T04:00:00Z]`

**Evaluation**

Europe/Berlin springs forward at `2025-03-30T01:00Z` (02:00 CET → 03:00 CEST). `bob`’s Saturday-owned shift: 22:00 CET (+01:00) on 03-29 = `21:00Z` → 06:00 CEST (+02:00) on 03-30 = `04:00Z`: `[2025-03-29T21:00Z, 2025-03-30T04:00Z]` = **7 h** (8 h nominal). Request Sunday 04:00–05:00 CEST = `[02:00Z, 03:00Z]` ⊆ shift ✔. `alice` (UTC, Saturday+Sunday 00:00–24:00) ✔. → `book`.

**Output** (`evaluate`)

```json
{
  "ok": true,
  "decision": "book",
  "requested": { "start": "2025-03-30T04:00:00+02:00", "end": "2025-03-30T05:00:00+02:00", "startUtc": "2025-03-30T02:00:00Z", "endUtc": "2025-03-30T03:00:00Z" },
  "slots": [{ "start": "2025-03-30T04:00:00+02:00", "end": "2025-03-30T05:00:00+02:00", "startUtc": "2025-03-30T02:00:00Z", "endUtc": "2025-03-30T03:00:00Z" }],
  "reasons": []
}
```

**CLI exit code:** `0` (with or without `--exit-code`)

---

### EX-15 — Australia/Sydney fall-back inside an overnight shift

**Covers:** southern-hemisphere DST end 2025-04-06 (AEDT +11:00 → AEST +10:00); the nominal 8-hour shift lasts 9 real hours

**Input**

- request: `2025-04-06` `04:00`→`05:00` in `Australia/Sydney`
- `alice` — `UTC` — weeklyRules: saturday–sunday 00:00–24:00
- `bob` — `Australia/Sydney` — weeklyRules: saturday 22:00–06:00
- options: now=`2025-04-01T00:00:00Z` (other options at defaults)

**Local → UTC expansion**

- request: 2025-04-06 04:00 (+10:00) → 2025-04-06 05:00 (+10:00) = `[2025-04-05T18:00:00Z, 2025-04-05T19:00:00Z]` (1 h)
- `alice` (`UTC`):
  - owner 2025-04-05 saturday 00:00–24:00: 2025-04-05 00:00 (+00:00) → 2025-04-06 00:00 (+00:00) = `[2025-04-05T00:00:00Z, 2025-04-06T00:00:00Z]`
  - owner 2025-04-06 sunday 00:00–24:00: 2025-04-06 00:00 (+00:00) → 2025-04-07 00:00 (+00:00) = `[2025-04-06T00:00:00Z, 2025-04-07T00:00:00Z]`
- `bob` (`Australia/Sydney`):
  - owner 2025-04-05 saturday 22:00–06:00: 2025-04-05 22:00 (+11:00) → 2025-04-06 06:00 (+10:00) = `[2025-04-05T11:00:00Z, 2025-04-05T20:00:00Z]`

**Merged availability** (blackouts removed, touching/overlapping instances merged; computed over the expanded search range, so a continuous run is cut at the range ends)

- `alice`: `[2025-04-05T00:00:00Z, 2025-04-07T00:00:00Z]`
- `bob`: `[2025-04-05T11:00:00Z, 2025-04-05T20:00:00Z]`

**Evaluation**

Sydney falls back at `2025-04-05T16:00Z` (03:00 AEDT → 02:00 AEST). `bob`’s Saturday-owned shift: 22:00 AEDT (+11:00) on 04-05 = `11:00Z` → 06:00 AEST (+10:00) on 04-06 = `20:00Z`: **9 h** (8 h nominal). Request Sunday 04:00–05:00 AEST = `[2025-04-05T18:00Z, 19:00Z]` ⊆ shift ✔. `alice` ✔. → `book`.

**Output** (`evaluate`)

```json
{
  "ok": true,
  "decision": "book",
  "requested": { "start": "2025-04-06T04:00:00+10:00", "end": "2025-04-06T05:00:00+10:00", "startUtc": "2025-04-05T18:00:00Z", "endUtc": "2025-04-05T19:00:00Z" },
  "slots": [{ "start": "2025-04-06T04:00:00+10:00", "end": "2025-04-06T05:00:00+10:00", "startUtc": "2025-04-05T18:00:00Z", "endUtc": "2025-04-05T19:00:00Z" }],
  "reasons": []
}
```

**CLI exit code:** `0` (with or without `--exit-code`)

---

### EX-16 — Australia/Lord_Howe: the 30-minute DST shift

**Covers:** E18: Lord_Howe goes +10:30 → +11:00 at 02:00 on 2025-10-05; 02:30 is the first valid local time after the gap

**Input**

- request: `2025-10-05` `02:30`→`03:30` in `Australia/Lord_Howe`
- `alice` — `UTC` — weeklyRules: saturday 00:00–24:00
- `bob` — `Australia/Lord_Howe` — weeklyRules: sunday 00:00–06:00
- options: now=`2025-10-01T00:00:00Z` (other options at defaults)

**Local → UTC expansion**

- request: 2025-10-05 02:30 (+11:00) → 2025-10-05 03:30 (+11:00) = `[2025-10-04T15:30:00Z, 2025-10-04T16:30:00Z]` (1 h)
- `alice` (`UTC`):
  - owner 2025-10-04 saturday 00:00–24:00: 2025-10-04 00:00 (+00:00) → 2025-10-05 00:00 (+00:00) = `[2025-10-04T00:00:00Z, 2025-10-05T00:00:00Z]`
- `bob` (`Australia/Lord_Howe`):
  - owner 2025-10-05 sunday 00:00–06:00: 2025-10-05 00:00 (+10:30) → 2025-10-05 06:00 (+11:00) = `[2025-10-04T13:30:00Z, 2025-10-04T19:00:00Z]`

**Merged availability** (blackouts removed, touching/overlapping instances merged; computed over the expanded search range, so a continuous run is cut at the range ends)

- `alice`: `[2025-10-04T00:00:00Z, 2025-10-05T00:00:00Z]`
- `bob`: `[2025-10-04T13:30:00Z, 2025-10-04T19:00:00Z]`

**Evaluation**

Lord_Howe: LHST +10:30; at 02:00 LHST (`2025-10-04T15:30Z`) clocks jump to 02:30 LHDT (+11:00). `bob`’s Sunday 00:00 LHST (+10:30) = `13:30Z`; 06:00 LHDT (+11:00) = `19:00Z`: `[13:30Z, 19:00Z]` = **5.5 h** (6 h nominal). The request start `02:30` exists (it is the first instant after the gap, and survives the round-trip check) = `15:30Z`; end `03:30 LHDT` = `16:30Z`. ⊆ shift ✔. `alice` (UTC Saturday 2025-10-04 covers the whole range) ✔. → `book`. A request starting at `02:15` would be `DST_NONEXISTENT_LOCAL_TIME`.

**Output** (`evaluate`)

```json
{
  "ok": true,
  "decision": "book",
  "requested": { "start": "2025-10-05T02:30:00+11:00", "end": "2025-10-05T03:30:00+11:00", "startUtc": "2025-10-04T15:30:00Z", "endUtc": "2025-10-04T16:30:00Z" },
  "slots": [{ "start": "2025-10-05T02:30:00+11:00", "end": "2025-10-05T03:30:00+11:00", "startUtc": "2025-10-04T15:30:00Z", "endUtc": "2025-10-04T16:30:00Z" }],
  "reasons": []
}
```

**CLI exit code:** `0` (with or without `--exit-code`)

---

### EX-17 — Half-hour and 45-minute offsets (+05:30, +05:45)

**Covers:** E18: Asia/Kolkata (+05:30) and Asia/Kathmandu (+05:45); counter-offer ranked by distance

**Input**

- request: `2025-01-13` `09:00`→`10:00` in `Asia/Kathmandu`
- `alice` — `Asia/Kolkata` — weeklyRules: monday–friday 09:00–17:00
- `bob` — `Asia/Kathmandu` — weeklyRules: monday–friday 09:00–17:00
- options: now=`2025-01-10T00:00:00Z` (other options at defaults)

**Local → UTC expansion**

- request: 2025-01-13 09:00 (+05:45) → 2025-01-13 10:00 (+05:45) = `[2025-01-13T03:15:00Z, 2025-01-13T04:15:00Z]` (1 h)
- `alice` (`Asia/Kolkata`):
  - owner 2025-01-13 monday 09:00–17:00: 2025-01-13 09:00 (+05:30) → 2025-01-13 17:00 (+05:30) = `[2025-01-13T03:30:00Z, 2025-01-13T11:30:00Z]`
  - owner 2025-01-14 tuesday 09:00–17:00: 2025-01-14 09:00 (+05:30) → 2025-01-14 17:00 (+05:30) = `[2025-01-14T03:30:00Z, 2025-01-14T11:30:00Z]`
- `bob` (`Asia/Kathmandu`):
  - owner 2025-01-13 monday 09:00–17:00: 2025-01-13 09:00 (+05:45) → 2025-01-13 17:00 (+05:45) = `[2025-01-13T03:15:00Z, 2025-01-13T11:15:00Z]`
  - owner 2025-01-14 tuesday 09:00–17:00: 2025-01-14 09:00 (+05:45) → 2025-01-14 17:00 (+05:45) = `[2025-01-14T03:15:00Z, 2025-01-14T11:15:00Z]`

**Merged availability** (blackouts removed, touching/overlapping instances merged; computed over the expanded search range, so a continuous run is cut at the range ends)

- `alice`: `[2025-01-13T03:30:00Z, 2025-01-13T11:30:00Z]`, `[2025-01-14T03:30:00Z, 2025-01-14T11:30:00Z]`
- `bob`: `[2025-01-13T03:15:00Z, 2025-01-13T11:15:00Z]`, `[2025-01-14T03:15:00Z, 2025-01-14T11:15:00Z]`

**Evaluation**

`alice` 09:00–17:00 IST (+05:30) = `[03:30Z, 11:30Z]`. `bob` 09:00–17:00 NPT (+05:45) = `[03:15Z, 11:15Z]`. The request `[03:15Z, 04:15Z]` ⊆ `bob` ✔ but begins 15 min before `alice` starts ✘. The nearest fitting start is `03:30Z` (15 min away). Greedy non-overlap (G22) picks it, skips `03:45Z`–`04:15Z` (each overlaps the pick), then takes `04:30Z` and `05:30Z`. Printed in the requester zone (+05:45) they are 09:15, 10:15 and 11:15.

**Output** (`evaluate`)

```json
{
  "ok": true,
  "decision": "counter_offer",
  "requested": { "start": "2025-01-13T09:00:00+05:45", "end": "2025-01-13T10:00:00+05:45", "startUtc": "2025-01-13T03:15:00Z", "endUtc": "2025-01-13T04:15:00Z" },
  "slots": [
    { "start": "2025-01-13T09:15:00+05:45", "end": "2025-01-13T10:15:00+05:45", "startUtc": "2025-01-13T03:30:00Z", "endUtc": "2025-01-13T04:30:00Z" },
    { "start": "2025-01-13T10:15:00+05:45", "end": "2025-01-13T11:15:00+05:45", "startUtc": "2025-01-13T04:30:00Z", "endUtc": "2025-01-13T05:30:00Z" },
    { "start": "2025-01-13T11:15:00+05:45", "end": "2025-01-13T12:15:00+05:45", "startUtc": "2025-01-13T05:30:00Z", "endUtc": "2025-01-13T06:30:00Z" }
  ],
  "reasons": [{ "code": "OUTSIDE_AVAILABILITY", "participantId": "alice", "message": "alice: requested interval is not inside any availability interval." }]
}
```

**CLI exit code:** `0`; `1` with `--exit-code`

---

### EX-18 — Blackout blocks an overnight shift that starts on it

**Covers:** C6: the blackout date blocks every interval that STARTS on that date, including the part after midnight

**Input**

- request: `2025-01-14` `02:00`→`03:00` in `Asia/Manila`
- `alice` — `America/New_York` — weeklyRules: monday–sunday 00:00–24:00
- `bob` — `Asia/Manila` — weeklyRules: monday 20:00–06:00 — blackouts: 2025-01-13
- options: now=`2025-01-10T00:00:00Z` (other options at defaults)

**Local → UTC expansion**

- request: 2025-01-14 02:00 (+08:00) → 2025-01-14 03:00 (+08:00) = `[2025-01-13T18:00:00Z, 2025-01-13T19:00:00Z]` (1 h)
- `alice` (`America/New_York`):
  - owner 2025-01-12 sunday 00:00–24:00: 2025-01-12 00:00 (-05:00) → 2025-01-13 00:00 (-05:00) = `[2025-01-12T05:00:00Z, 2025-01-13T05:00:00Z]`
  - owner 2025-01-13 monday 00:00–24:00: 2025-01-13 00:00 (-05:00) → 2025-01-14 00:00 (-05:00) = `[2025-01-13T05:00:00Z, 2025-01-14T05:00:00Z]`
  - owner 2025-01-14 tuesday 00:00–24:00: 2025-01-14 00:00 (-05:00) → 2025-01-15 00:00 (-05:00) = `[2025-01-14T05:00:00Z, 2025-01-15T05:00:00Z]`
  - owner 2025-01-20 monday 00:00–24:00: 2025-01-20 00:00 (-05:00) → 2025-01-21 00:00 (-05:00) = `[2025-01-20T05:00:00Z, 2025-01-21T05:00:00Z]`
- `bob` (`Asia/Manila`):
  - owner 2025-01-13 monday 20:00–06:00: 2025-01-13 20:00 (+08:00) → 2025-01-14 06:00 (+08:00) = `[2025-01-13T12:00:00Z, 2025-01-13T22:00:00Z]` — **blocked by blackout (C6)**
  - owner 2025-01-20 monday 20:00–06:00: 2025-01-20 20:00 (+08:00) → 2025-01-21 06:00 (+08:00) = `[2025-01-20T12:00:00Z, 2025-01-20T22:00:00Z]`

**Merged availability** (blackouts removed, touching/overlapping instances merged; computed over the expanded search range, so a continuous run is cut at the range ends)

- `alice`: `[2024-12-26T05:00:00Z, 2025-01-31T05:00:00Z]`
- `bob`: `[2025-01-20T12:00:00Z, 2025-01-20T22:00:00Z]`

**Evaluation**

`bob`’s Monday shift starts on the blackout date `2025-01-13` (local, Manila), so the whole instance `[Jan 13 12:00Z, 22:00Z]` is removed (C6), including the part after midnight. The request `[18:00Z, 19:00Z]` would be inside it → `IN_BLACKOUT`. Next unblocked shift: owner `2025-01-20`. Greedy non-overlap (G22) picks `2025-01-20T12:00Z`, `13:00Z` and `14:00Z` (the 15-minute starts between them overlap an earlier pick). The earlier shift (owner `2025-01-06`) is farther away: its last fitting start, `2025-01-06T21:00Z`, is 165 h from the requested start, against 162–164 h for the picks.

A blackout on `2025-01-14` (Tuesday, the request’s calendar date) would **not** block this request; only the date the interval starts on matters.

**Output** (`evaluate`)

```json
{
  "ok": true,
  "decision": "counter_offer",
  "requested": { "start": "2025-01-14T02:00:00+08:00", "end": "2025-01-14T03:00:00+08:00", "startUtc": "2025-01-13T18:00:00Z", "endUtc": "2025-01-13T19:00:00Z" },
  "slots": [
    { "start": "2025-01-20T20:00:00+08:00", "end": "2025-01-20T21:00:00+08:00", "startUtc": "2025-01-20T12:00:00Z", "endUtc": "2025-01-20T13:00:00Z" },
    { "start": "2025-01-20T21:00:00+08:00", "end": "2025-01-20T22:00:00+08:00", "startUtc": "2025-01-20T13:00:00Z", "endUtc": "2025-01-20T14:00:00Z" },
    { "start": "2025-01-20T22:00:00+08:00", "end": "2025-01-20T23:00:00+08:00", "startUtc": "2025-01-20T14:00:00Z", "endUtc": "2025-01-20T15:00:00Z" }
  ],
  "reasons": [{ "code": "IN_BLACKOUT", "participantId": "bob", "message": "bob: availability is blocked by blackout date 2025-01-13." }]
}
```

**CLI exit code:** `0`; `1` with `--exit-code`

---

### EX-19 — Request before now

**Covers:** C8: request starting before `now` → counter_offer with `IN_PAST`; candidates start at or after `now`

**Input**

- request: `2025-01-06` `09:30`→`10:30` in `America/New_York`
- `alice` — `America/New_York` — weeklyRules: monday–friday 09:00–17:00
- `bob` — `Europe/London` — weeklyRules: monday–friday 09:00–17:00
- options: now=`2025-01-06T15:00:00Z` (other options at defaults)

**Local → UTC expansion**

- request: 2025-01-06 09:30 (-05:00) → 2025-01-06 10:30 (-05:00) = `[2025-01-06T14:30:00Z, 2025-01-06T15:30:00Z]` (1 h)
- `alice` (`America/New_York`):
  - owner 2025-01-06 monday 09:00–17:00: 2025-01-06 09:00 (-05:00) → 2025-01-06 17:00 (-05:00) = `[2025-01-06T14:00:00Z, 2025-01-06T22:00:00Z]`
  - owner 2025-01-07 tuesday 09:00–17:00: 2025-01-07 09:00 (-05:00) → 2025-01-07 17:00 (-05:00) = `[2025-01-07T14:00:00Z, 2025-01-07T22:00:00Z]`
- `bob` (`Europe/London`):
  - owner 2025-01-06 monday 09:00–17:00: 2025-01-06 09:00 (+00:00) → 2025-01-06 17:00 (+00:00) = `[2025-01-06T09:00:00Z, 2025-01-06T17:00:00Z]`
  - owner 2025-01-07 tuesday 09:00–17:00: 2025-01-07 09:00 (+00:00) → 2025-01-07 17:00 (+00:00) = `[2025-01-07T09:00:00Z, 2025-01-07T17:00:00Z]`

**Merged availability** (blackouts removed, touching/overlapping instances merged; computed over the expanded search range, so a continuous run is cut at the range ends)

- `alice`: `[2025-01-06T14:00:00Z, 2025-01-06T22:00:00Z]`, `[2025-01-07T14:00:00Z, 2025-01-07T22:00:00Z]`
- `bob`: `[2025-01-06T09:00:00Z, 2025-01-06T17:00:00Z]`, `[2025-01-07T09:00:00Z, 2025-01-07T17:00:00Z]`

**Evaluation**

Request start `14:30Z` < `now` `15:00Z` → `IN_PAST` (global reason, no participantId). Both parties would otherwise contain the request, so no participant reason is added. Candidates must start at or after `now`. Greedy non-overlap (G22) picks `15:00Z` (30 min from the requested start) and `16:00Z` (1 h 30 min; `15:15Z`–`15:45Z` overlap the first pick). A start of `17:00Z` would end after `bob`’s window (`17:00Z`), so the third pick is the first fitting start of the next day, `2025-01-07T14:00Z` (23 h 30 min away).

**Output** (`evaluate`)

```json
{
  "ok": true,
  "decision": "counter_offer",
  "requested": { "start": "2025-01-06T09:30:00-05:00", "end": "2025-01-06T10:30:00-05:00", "startUtc": "2025-01-06T14:30:00Z", "endUtc": "2025-01-06T15:30:00Z" },
  "slots": [
    { "start": "2025-01-06T10:00:00-05:00", "end": "2025-01-06T11:00:00-05:00", "startUtc": "2025-01-06T15:00:00Z", "endUtc": "2025-01-06T16:00:00Z" },
    { "start": "2025-01-06T11:00:00-05:00", "end": "2025-01-06T12:00:00-05:00", "startUtc": "2025-01-06T16:00:00Z", "endUtc": "2025-01-06T17:00:00Z" },
    { "start": "2025-01-07T09:00:00-05:00", "end": "2025-01-07T10:00:00-05:00", "startUtc": "2025-01-07T14:00:00Z", "endUtc": "2025-01-07T15:00:00Z" }
  ],
  "reasons": [{ "code": "IN_PAST", "message": "Requested start 2025-01-06T14:30:00Z is before now 2025-01-06T15:00:00Z." }]
}
```

**CLI exit code:** `0`; `1` with `--exit-code`

---

### EX-20 — minNoticeMinutes

**Covers:** C8: `minNoticeMinutes` raises the lower bound to now + notice; `INSUFFICIENT_NOTICE`

**Input**

- request: `2025-01-06` `09:00`→`10:00` in `America/New_York`
- `alice` — `America/New_York` — weeklyRules: monday–friday 09:00–17:00
- `bob` — `Europe/London` — weeklyRules: monday–friday 09:00–17:00
- options: now=`2025-01-06T13:00:00Z`, minNoticeMinutes=120 (other options at defaults)

**Local → UTC expansion**

- request: 2025-01-06 09:00 (-05:00) → 2025-01-06 10:00 (-05:00) = `[2025-01-06T14:00:00Z, 2025-01-06T15:00:00Z]` (1 h)
- `alice` (`America/New_York`):
  - owner 2025-01-06 monday 09:00–17:00: 2025-01-06 09:00 (-05:00) → 2025-01-06 17:00 (-05:00) = `[2025-01-06T14:00:00Z, 2025-01-06T22:00:00Z]`
  - owner 2025-01-07 tuesday 09:00–17:00: 2025-01-07 09:00 (-05:00) → 2025-01-07 17:00 (-05:00) = `[2025-01-07T14:00:00Z, 2025-01-07T22:00:00Z]`
- `bob` (`Europe/London`):
  - owner 2025-01-06 monday 09:00–17:00: 2025-01-06 09:00 (+00:00) → 2025-01-06 17:00 (+00:00) = `[2025-01-06T09:00:00Z, 2025-01-06T17:00:00Z]`
  - owner 2025-01-07 tuesday 09:00–17:00: 2025-01-07 09:00 (+00:00) → 2025-01-07 17:00 (+00:00) = `[2025-01-07T09:00:00Z, 2025-01-07T17:00:00Z]`

**Merged availability** (blackouts removed, touching/overlapping instances merged; computed over the expanded search range, so a continuous run is cut at the range ends)

- `alice`: `[2025-01-06T14:00:00Z, 2025-01-06T22:00:00Z]`, `[2025-01-07T14:00:00Z, 2025-01-07T22:00:00Z]`
- `bob`: `[2025-01-06T09:00:00Z, 2025-01-06T17:00:00Z]`, `[2025-01-07T09:00:00Z, 2025-01-07T17:00:00Z]`

**Evaluation**

`now` + 120 min = `15:00Z`. The request start `14:00Z` is not in the past (≥ `now`) but is before the lower bound → `INSUFFICIENT_NOTICE`. Candidates start at or after `15:00Z`. Greedy non-overlap (G22) picks `15:00Z` (1 h from the requested start), `16:00Z` (2 h) and then `2025-01-07T14:00Z` (24 h), because a `17:00Z` start would end after `bob`’s window. Both parties would otherwise contain the request.

**Output** (`evaluate`)

```json
{
  "ok": true,
  "decision": "counter_offer",
  "requested": { "start": "2025-01-06T09:00:00-05:00", "end": "2025-01-06T10:00:00-05:00", "startUtc": "2025-01-06T14:00:00Z", "endUtc": "2025-01-06T15:00:00Z" },
  "slots": [
    { "start": "2025-01-06T10:00:00-05:00", "end": "2025-01-06T11:00:00-05:00", "startUtc": "2025-01-06T15:00:00Z", "endUtc": "2025-01-06T16:00:00Z" },
    { "start": "2025-01-06T11:00:00-05:00", "end": "2025-01-06T12:00:00-05:00", "startUtc": "2025-01-06T16:00:00Z", "endUtc": "2025-01-06T17:00:00Z" },
    { "start": "2025-01-07T09:00:00-05:00", "end": "2025-01-07T10:00:00-05:00", "startUtc": "2025-01-07T14:00:00Z", "endUtc": "2025-01-07T15:00:00Z" }
  ],
  "reasons": [{ "code": "INSUFFICIENT_NOTICE", "message": "Requested start 2025-01-06T14:00:00Z is earlier than now plus 120 minutes (2025-01-06T15:00:00Z)." }]
}
```

**CLI exit code:** `0`; `1` with `--exit-code`

---

### EX-21 — Counter-offer ranking and tie-break

**Covers:** C9: rank by absolute distance from the requested start; ties → earlier first; output is rank order, not chronological

**Input**

- request: `2025-01-06` `10:00`→`11:00` in `Europe/London`
- `alice` — `Europe/London` — weeklyRules: monday–friday 08:00–10:00, 11:00–13:00
- `bob` — `UTC` — weeklyRules: monday–friday 00:00–24:00
- options: now=`2025-01-03T00:00:00Z` (other options at defaults)

**Local → UTC expansion**

- request: 2025-01-06 10:00 (+00:00) → 2025-01-06 11:00 (+00:00) = `[2025-01-06T10:00:00Z, 2025-01-06T11:00:00Z]` (1 h)
- `alice` (`Europe/London`):
  - owner 2025-01-06 monday 08:00–10:00: 2025-01-06 08:00 (+00:00) → 2025-01-06 10:00 (+00:00) = `[2025-01-06T08:00:00Z, 2025-01-06T10:00:00Z]`
  - owner 2025-01-06 monday 11:00–13:00: 2025-01-06 11:00 (+00:00) → 2025-01-06 13:00 (+00:00) = `[2025-01-06T11:00:00Z, 2025-01-06T13:00:00Z]`
  - owner 2025-01-07 tuesday 08:00–10:00: 2025-01-07 08:00 (+00:00) → 2025-01-07 10:00 (+00:00) = `[2025-01-07T08:00:00Z, 2025-01-07T10:00:00Z]`
- `bob` (`UTC`):
  - owner 2025-01-06 monday 00:00–24:00: 2025-01-06 00:00 (+00:00) → 2025-01-07 00:00 (+00:00) = `[2025-01-06T00:00:00Z, 2025-01-07T00:00:00Z]`
  - owner 2025-01-07 tuesday 00:00–24:00: 2025-01-07 00:00 (+00:00) → 2025-01-08 00:00 (+00:00) = `[2025-01-07T00:00:00Z, 2025-01-08T00:00:00Z]`

**Merged availability** (blackouts removed, touching/overlapping instances merged; computed over the expanded search range, so a continuous run is cut at the range ends)

- `alice`: `[2025-01-06T08:00:00Z, 2025-01-06T10:00:00Z]`, `[2025-01-06T11:00:00Z, 2025-01-06T13:00:00Z]`, `[2025-01-07T08:00:00Z, 2025-01-07T10:00:00Z]`
- `bob`: `[2025-01-06T00:00:00Z, 2025-01-11T00:00:00Z]`

**Evaluation**

`alice` (London, GMT = UTC): `[08:00Z, 10:00Z]` and `[11:00Z, 13:00Z]`, which do not touch, so they stay separate. The request `[10:00Z, 11:00Z]` falls exactly in the gap ✘. Distances from the requested start: 09:00 → 1 h; 11:00 → 1 h (tie → **earlier first**); 08:45 → 1 h 15 m; 11:15 → 1 h 15 m (tie → earlier first). Greedy non-overlap (G22): pick 09:00 and 11:00; skip 08:45, 11:15, 08:30, 11:30, 08:15 and 11:45 (each overlaps a pick); 08:00 (2 h away, touching the 09:00 slot) and 12:00 (2 h away) tie, and the earlier wins. With `maxSuggestions = 3` the result is `[09:00, 11:00, 08:00]`. The output order is **rank order**, not chronological.

**Output** (`evaluate`)

```json
{
  "ok": true,
  "decision": "counter_offer",
  "requested": { "start": "2025-01-06T10:00:00+00:00", "end": "2025-01-06T11:00:00+00:00", "startUtc": "2025-01-06T10:00:00Z", "endUtc": "2025-01-06T11:00:00Z" },
  "slots": [
    { "start": "2025-01-06T09:00:00+00:00", "end": "2025-01-06T10:00:00+00:00", "startUtc": "2025-01-06T09:00:00Z", "endUtc": "2025-01-06T10:00:00Z" },
    { "start": "2025-01-06T11:00:00+00:00", "end": "2025-01-06T12:00:00+00:00", "startUtc": "2025-01-06T11:00:00Z", "endUtc": "2025-01-06T12:00:00Z" },
    { "start": "2025-01-06T08:00:00+00:00", "end": "2025-01-06T09:00:00+00:00", "startUtc": "2025-01-06T08:00:00Z", "endUtc": "2025-01-06T09:00:00Z" }
  ],
  "reasons": [{ "code": "OUTSIDE_AVAILABILITY", "participantId": "alice", "message": "alice: requested interval is not inside any availability interval." }]
}
```

**CLI exit code:** `0`; `1` with `--exit-code`

---

### EX-22 — Three participants, with the explain trace

**Covers:** D13 (N participants); D15 `ExplainResult`; ruleMatched/reasonCode per participant per candidate

**Input**

- request: `2025-01-06` `09:00`→`10:00` in `America/New_York`
- `alice` — `America/New_York` — weeklyRules: monday–friday 09:00–17:00
- `bob` — `Europe/London` — weeklyRules: monday–friday 09:00–17:00
- `carol` — `America/Chicago` — weeklyRules: monday–friday 10:00–18:00
- options: now=`2025-01-03T12:00:00Z` (other options at defaults)

**Local → UTC expansion**

- request: 2025-01-06 09:00 (-05:00) → 2025-01-06 10:00 (-05:00) = `[2025-01-06T14:00:00Z, 2025-01-06T15:00:00Z]` (1 h)
- `alice` (`America/New_York`):
  - owner 2025-01-06 monday 09:00–17:00: 2025-01-06 09:00 (-05:00) → 2025-01-06 17:00 (-05:00) = `[2025-01-06T14:00:00Z, 2025-01-06T22:00:00Z]`
  - owner 2025-01-07 tuesday 09:00–17:00: 2025-01-07 09:00 (-05:00) → 2025-01-07 17:00 (-05:00) = `[2025-01-07T14:00:00Z, 2025-01-07T22:00:00Z]`
  - owner 2025-01-08 wednesday 09:00–17:00: 2025-01-08 09:00 (-05:00) → 2025-01-08 17:00 (-05:00) = `[2025-01-08T14:00:00Z, 2025-01-08T22:00:00Z]`
- `bob` (`Europe/London`):
  - owner 2025-01-06 monday 09:00–17:00: 2025-01-06 09:00 (+00:00) → 2025-01-06 17:00 (+00:00) = `[2025-01-06T09:00:00Z, 2025-01-06T17:00:00Z]`
  - owner 2025-01-07 tuesday 09:00–17:00: 2025-01-07 09:00 (+00:00) → 2025-01-07 17:00 (+00:00) = `[2025-01-07T09:00:00Z, 2025-01-07T17:00:00Z]`
  - owner 2025-01-08 wednesday 09:00–17:00: 2025-01-08 09:00 (+00:00) → 2025-01-08 17:00 (+00:00) = `[2025-01-08T09:00:00Z, 2025-01-08T17:00:00Z]`
- `carol` (`America/Chicago`):
  - owner 2025-01-06 monday 10:00–18:00: 2025-01-06 10:00 (-06:00) → 2025-01-06 18:00 (-06:00) = `[2025-01-06T16:00:00Z, 2025-01-07T00:00:00Z]`
  - owner 2025-01-07 tuesday 10:00–18:00: 2025-01-07 10:00 (-06:00) → 2025-01-07 18:00 (-06:00) = `[2025-01-07T16:00:00Z, 2025-01-08T00:00:00Z]`
  - owner 2025-01-08 wednesday 10:00–18:00: 2025-01-08 10:00 (-06:00) → 2025-01-08 18:00 (-06:00) = `[2025-01-08T16:00:00Z, 2025-01-09T00:00:00Z]`

**Merged availability** (blackouts removed, touching/overlapping instances merged; computed over the expanded search range, so a continuous run is cut at the range ends)

- `alice`: `[2025-01-06T14:00:00Z, 2025-01-06T22:00:00Z]`, `[2025-01-07T14:00:00Z, 2025-01-07T22:00:00Z]`, `[2025-01-08T14:00:00Z, 2025-01-08T22:00:00Z]`
- `bob`: `[2025-01-06T09:00:00Z, 2025-01-06T17:00:00Z]`, `[2025-01-07T09:00:00Z, 2025-01-07T17:00:00Z]`, `[2025-01-08T09:00:00Z, 2025-01-08T17:00:00Z]`
- `carol`: `[2025-01-06T16:00:00Z, 2025-01-07T00:00:00Z]`, `[2025-01-07T16:00:00Z, 2025-01-08T00:00:00Z]`, `[2025-01-08T16:00:00Z, 2025-01-09T00:00:00Z]`

**Evaluation**

`carol` (Chicago, CST −06:00) 10:00–18:00 = `[16:00Z, 00:00Z+1d]`. All three windows intersect on `[16:00Z, 17:00Z]` only. The request `[14:00Z, 15:00Z]` fails `carol` ✘ (`alice` and `bob` pass). One 1-h slot fits per day (start `16:00Z`): Mon (2 h away), Tue (26 h), Wed (50 h). Friday `2025-01-03T16:00Z` is also ≥ `now` but 70 h away, so it ranks fourth.

This example is shown with `explain`. `checks` are ordered by `participant` id; `ruleMatched` is the rule instance that contains the slot start (`null` on failure).

**Output** (`explain`)

```json
{
  "ok": true,
  "decision": "counter_offer",
  "reasons": [{ "code": "OUTSIDE_AVAILABILITY", "participantId": "carol", "message": "carol: requested interval is not inside any availability interval." }],
  "requested": {
    "slot": { "start": "2025-01-06T09:00:00-05:00", "end": "2025-01-06T10:00:00-05:00", "startUtc": "2025-01-06T14:00:00Z", "endUtc": "2025-01-06T15:00:00Z" },
    "pass": false,
    "timeGate": "OK",
    "checks": [
      { "participant": "alice", "ruleMatched": { "weekday": "monday", "start": "09:00", "end": "17:00", "ownerDate": "2025-01-06" }, "pass": true, "reasonCode": "OK" },
      { "participant": "bob", "ruleMatched": { "weekday": "monday", "start": "09:00", "end": "17:00", "ownerDate": "2025-01-06" }, "pass": true, "reasonCode": "OK" },
      { "participant": "carol", "ruleMatched": null, "pass": false, "reasonCode": "OUTSIDE_AVAILABILITY" }
    ]
  },
  "candidates": [
    {
      "slot": { "start": "2025-01-06T11:00:00-05:00", "end": "2025-01-06T12:00:00-05:00", "startUtc": "2025-01-06T16:00:00Z", "endUtc": "2025-01-06T17:00:00Z" },
      "pass": true,
      "timeGate": "OK",
      "checks": [
        { "participant": "alice", "ruleMatched": { "weekday": "monday", "start": "09:00", "end": "17:00", "ownerDate": "2025-01-06" }, "pass": true, "reasonCode": "OK" },
        { "participant": "bob", "ruleMatched": { "weekday": "monday", "start": "09:00", "end": "17:00", "ownerDate": "2025-01-06" }, "pass": true, "reasonCode": "OK" },
        { "participant": "carol", "ruleMatched": { "weekday": "monday", "start": "10:00", "end": "18:00", "ownerDate": "2025-01-06" }, "pass": true, "reasonCode": "OK" }
      ]
    },
    {
      "slot": { "start": "2025-01-07T11:00:00-05:00", "end": "2025-01-07T12:00:00-05:00", "startUtc": "2025-01-07T16:00:00Z", "endUtc": "2025-01-07T17:00:00Z" },
      "pass": true,
      "timeGate": "OK",
      "checks": [
        { "participant": "alice", "ruleMatched": { "weekday": "tuesday", "start": "09:00", "end": "17:00", "ownerDate": "2025-01-07" }, "pass": true, "reasonCode": "OK" },
        { "participant": "bob", "ruleMatched": { "weekday": "tuesday", "start": "09:00", "end": "17:00", "ownerDate": "2025-01-07" }, "pass": true, "reasonCode": "OK" },
        { "participant": "carol", "ruleMatched": { "weekday": "tuesday", "start": "10:00", "end": "18:00", "ownerDate": "2025-01-07" }, "pass": true, "reasonCode": "OK" }
      ]
    },
    {
      "slot": { "start": "2025-01-08T11:00:00-05:00", "end": "2025-01-08T12:00:00-05:00", "startUtc": "2025-01-08T16:00:00Z", "endUtc": "2025-01-08T17:00:00Z" },
      "pass": true,
      "timeGate": "OK",
      "checks": [
        { "participant": "alice", "ruleMatched": { "weekday": "wednesday", "start": "09:00", "end": "17:00", "ownerDate": "2025-01-08" }, "pass": true, "reasonCode": "OK" },
        { "participant": "bob", "ruleMatched": { "weekday": "wednesday", "start": "09:00", "end": "17:00", "ownerDate": "2025-01-08" }, "pass": true, "reasonCode": "OK" },
        { "participant": "carol", "ruleMatched": { "weekday": "wednesday", "start": "10:00", "end": "18:00", "ownerDate": "2025-01-08" }, "pass": true, "reasonCode": "OK" }
      ]
    }
  ]
}
```

**CLI exit code:** `0`; `1` with `--exit-code`

---

### EX-23 — Ambiguous abbreviation "IST"

**Covers:** C11: zone validation happens before Luxon; `IST` → `AMBIGUOUS_ZONE`, exit 3, with candidates

**Input**

- request: `2025-01-06` `09:00`→`10:00` in `America/New_York`
- `alice` — `America/New_York` — weeklyRules: monday–friday 09:00–17:00
- `bob` — `IST` — weeklyRules: monday–friday 09:00–17:00
- options: now=`2025-01-03T12:00:00Z` (other options at defaults)

Zones are validated before Luxon sees them (C11), in order: `request.timeZone`, then `participants[0..n].timeZone`. Luxon would accept `IST` as a valid zone and silently pick one, so Tempo asks instead. The `options` list comes from the abbreviation table in §7. The CLI prints this object on stdout (with `--json`) and exits `3`.

**Output**

```json
{
  "ok": false,
  "error": {
    "code": "AMBIGUOUS_ZONE",
    "message": "Time zone abbreviation \"IST\" is ambiguous; use an IANA zone.",
    "details": { "field": "participants[1].timeZone", "value": "IST", "options": ["Asia/Kolkata", "Europe/Dublin", "Asia/Jerusalem"] }
  }
}
```

**CLI exit code:** `3`

---

### EX-24 — Rule boundary inside a DST gap

**Covers:** rule-boundary policy A-07/G34: a nonexistent rule boundary resolves to the transition instant and emits `DST_RULE_ADJUSTED`

**Input**

- request: `2025-03-09` `04:00`→`05:00` in `America/New_York`
- `alice` — `UTC` — weeklyRules: sunday 00:00–24:00
- `bob` — `America/New_York` — weeklyRules: sunday 02:30–10:00
- options: now=`2025-03-01T00:00:00Z` (other options at defaults)

**Local → UTC expansion**

- request: 2025-03-09 04:00 (-04:00) → 2025-03-09 05:00 (-04:00) = `[2025-03-09T08:00:00Z, 2025-03-09T09:00:00Z]` (1 h)
- `alice` (`UTC`):
  - owner 2025-03-09 sunday 00:00–24:00: 2025-03-09 00:00 (+00:00) → 2025-03-10 00:00 (+00:00) = `[2025-03-09T00:00:00Z, 2025-03-10T00:00:00Z]`
- `bob` (`America/New_York`):
  - owner 2025-03-09 sunday 02:30–10:00: 2025-03-09 02:30 [nonexistent → resolved to the transition instant 2025-03-09T07:00:00Z] → 2025-03-09 10:00 (-04:00) = `[2025-03-09T07:00:00Z, 2025-03-09T14:00:00Z]`

**Merged availability** (blackouts removed, touching/overlapping instances merged; computed over the expanded search range, so a continuous run is cut at the range ends)

- `alice`: `[2025-03-09T00:00:00Z, 2025-03-10T00:00:00Z]`
- `bob`: `[2025-03-09T07:00:00Z, 2025-03-09T14:00:00Z]`

**Evaluation**

`bob`’s Sunday rule `02:30–10:00` America/New_York on 2025-03-09: `02:30` does not exist (gap `02:00–03:00`), so the boundary resolves to the transition instant `03:00 EDT` = `07:00Z` (G34); `10:00 EDT` = `14:00Z`. Instance `[07:00Z, 14:00Z]`. Request `04:00–05:00 EDT` = `[08:00Z, 09:00Z]` ⊆ ✔. `alice` (UTC) ✔. → `book`, with an informational `DST_RULE_ADJUSTED` reason because the adjusted instance overlaps the request.

Policy A-07 as amended by G34: a rule boundary in a gap resolves to the transition instant; in an overlap it resolves to the **earlier** occurrence. The reason is attached only when the adjusted instance overlaps the requested interval.

**Output** (`evaluate`)

```json
{
  "ok": true,
  "decision": "book",
  "requested": { "start": "2025-03-09T04:00:00-04:00", "end": "2025-03-09T05:00:00-04:00", "startUtc": "2025-03-09T08:00:00Z", "endUtc": "2025-03-09T09:00:00Z" },
  "slots": [{ "start": "2025-03-09T04:00:00-04:00", "end": "2025-03-09T05:00:00-04:00", "startUtc": "2025-03-09T08:00:00Z", "endUtc": "2025-03-09T09:00:00Z" }],
  "reasons": [{ "code": "DST_RULE_ADJUSTED", "participantId": "bob", "message": "bob: rule boundary 2025-03-09T02:30 in America/New_York is nonexistent; resolved to 2025-03-09T07:00:00Z." }]
}
```

**CLI exit code:** `0` (with or without `--exit-code`)

---

## 7. Zone abbreviation table (C11, ADR 2)

A zone string is checked **before Luxon**, case-insensitively, against this table. A hit is an `AMBIGUOUS_ZONE` error (exit 3) carrying `options` in the order listed. `UTC` and `GMT` are accepted as zones. Any other string that is not an IANA id is `INVALID_ZONE` (exit 2). IANA ids not in this table (including legacy ids such as `CET`) are accepted as-is (A-14).

| Abbreviation | `options` (in order) | Meaning of each option |
|---|---|---|
| `IST` | `Asia/Kolkata`, `Europe/Dublin`, `Asia/Jerusalem` | India Standard Time (+05:30); Irish Standard Time (+01:00, summer only); Israel Standard Time (+02:00, winter) |
| `CST` | `America/Chicago`, `Asia/Shanghai`, `America/Havana` | Central Standard Time (−06:00); China Standard Time (+08:00); Cuba Standard Time (−05:00) |
| `BST` | `Europe/London`, `Asia/Dhaka` | British Summer Time (+01:00); Bangladesh Standard Time (+06:00) |
| `EST` | `America/New_York`, `America/Toronto`, `Australia/Sydney` | Eastern Standard Time (−05:00); same (−05:00); Australian Eastern Standard Time, colloquially “EST” (+10:00) |
| `PST` | `America/Los_Angeles`, `Asia/Manila`, `Asia/Karachi` | Pacific Standard Time (−08:00); Philippine Standard Time (+08:00); Pakistan Standard Time (+05:00) |
| `MST` | `America/Denver`, `America/Phoenix` | Mountain Standard Time (−07:00); Mountain Standard Time, no DST (−07:00) |
| `HST` | `Pacific/Honolulu`, `America/Adak` | Hawaii Standard Time (−10:00); Hawaii–Aleutian Standard Time (−10:00, winter) |

`EST`, `MST` and `HST` are also fixed-offset legacy tzdb ids that Luxon accepts; Tempo still rejects them (C11). The table is data, not locked by `DECISIONS.md`; adding rows is a non-breaking change, removing or reordering is breaking.

## 8. Out of scope for v0.1.0

* Calendar API access (Deskhand MCP).
* Natural-language parsing; the caller or LLM extracts the fields.
* Recurring-meeting expansion; a single contiguous meeting.
* Blackout date **ranges** (callers expand ranges into dates; A-15) and per-party minimum notice (A-02).
* A GUI.

(N participants are **in** scope since D13; the earlier “two parties only” non-goal is withdrawn.)

## 9. Where each locked decision lands in this spec

| Decision | Spec section(s) |
|---|---|
| A1, A2 (workspace/config) | `ARCHITECTURE.md` §1, §2; not specified here |
| C5 interval algebra, `24:00`, `start == end` | §3.2, §4.3; EX-05, EX-07, EX-09 |
| C6 blackout in the party’s zone, blocks intervals that start on the date | §4.3; EX-04, EX-18 |
| C7 request `end < start` (amended by G23) | §4.4; EX-08, EX-10 |
| C8 `now`, `minNoticeMinutes`, request before now | §3.2, §4.5; EX-19, EX-20 |
| C9 search horizon, step, ranking, tie-break; G22 non-overlapping picks | §4.7; EX-04, EX-06, EX-17 … EX-21 |
| C10 nonexistent and ambiguous local times rejected | §3.4, §4.2; EX-12, EX-13 |
| C11 zone validation before Luxon, abbreviation table | §4.1, §7; EX-23 |
| C12 Luxon, not Temporal | `ARCHITECTURE.md` ADR 1 |
| D13 `participants[]`, errors as values | §2, §3.2, §3.4; EX-22 |
| D14 exit codes, `--exit-code`; G24 exit 4 | §5; every example’s “CLI exit code” line |
| D15 `ExplainResult` | §3.6; EX-22 |
| D16 `dst.ts`, root `SKILL.md` | `ARCHITECTURE.md` §1 |
| E17–E19 test strategy | `TEST_PLAN.md` |
| F20 milestones | `ROADMAP.md` |
| F21 README demo | `README.md` |
