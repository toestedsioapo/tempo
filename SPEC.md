# Tempo Specification

## 1. Overview
Tempo is a planning-review CLI that computes availability slots across two (or more) participants with DST-aware zones, blackout dates, counter-offer search, and per-candidate traceability.
This specification is a planning document; no implementation code is written.
## 2. Design Principles
1. Pure computation core: no exceptions; results are either { ok: true, ... } or { ok: false, error }.
2. DST-aware: all local times are converted to absolute UTC using the IANA zone database at computation time.
3. Determinism: same inputs always produce the same outputs; worked examples in this document are verified by hand.
4. No partial failure: malformed input is reported as an error result, never as a thrown exception.
## 3. Core Types
### 3.1 Participant rules
+ PartyRules:
  - partyId: string
  - zone: string (IANA, e.g. America/New_York; UTC and GMT allowed)
  - availability: Interval[] (local times in that party zone)
  - blackouts: Date[] (dates in that party zone)
  - minimumNoticeMinutes: number (default 0)
### 3.2 Interval
{ start: string (HH:MM, 24h); end: string (HH:MM, 24h); end may be 24:00 but never equal to start }
### 3.3 NegotiationResult
  OR { ok: false; error: { code: string; message: string } }
### 3.4 ErrorResult
{ ok: false; error: { code: string; message: string } }
### 3.5 CounterOffer
{ reason: string; candidates: CandidateSlot[] }
## 4. Semantics
### 4.1 Parties
A Tempo problem is defined by the union of all parties. Each party is a set of availability intervals (local times in that party zone) plus a set of blackout dates. All interval arithmetic is performed in absolute UTC; local times are converted using IANA zone definitions.
### 4.2 Interval algebra
Intervals are represented as local wall-clock values in the party zone. At computation time, each local interval is expanded to absolute UTC using the zone database. A vacation day is an interval from the party zone wall-clock day start to wall-clock day end (e.g., 2025-03-09 09:00 to 2025-03-09 17:00).
Intervals are independent of DST transitions: the conversion is zone-aware, not wall-clock arithmetic. The same wall-clock interval in a zone with DST has different UTC spans before and after the transition.
### 4.3 Rules
Rules operate on expanded UTC intervals. Each rule is keyed by a ruleCode constant and returns a boolean per candidate per participant:
Available if the requested interval is fully contained in the participant availability merged intervals and outside all blackout dates; pass = true, otherwise pass = false with a reasonCode.
### 4.4 Time primitives
now: string (ISO-8601 UTC, e.g. 2025-01-01T09:00:00Z)
minNoticeMinutes: number (default 0)
searchHorizonDays: number (default 14)
searchStepMinutes: number (default 15)
zone: string (IANA zone, e.g. America/New_York; UTC and GMT allowed)
## 5. Worked Examples
### Example 1: Simple overlap
Party A (America/New_York): 2025-01-06 09:00-17:00 EST.
Party B (Europe/London): 2025-01-06 09:00-17:00 GMT.
Request: start 2025-01-06T14:00Z end 2025-01-06T19:00Z.
Expanded UTC:
  Party A: [2025-01-06T14:00Z, 2025-01-06T22:00Z]
  Party B: [2025-01-06T09:00Z, 2025-01-06T16:00Z]
Intersection: [2025-01-06T14:00Z, 2025-01-06T16:00Z] - 2 hours.
Result: { ok: true, slots: [ { start: 2025-01-06T15:00Z, end: 2025-01-06T16:00Z } ] }
### Example 2: DST transition
Party A: America/New_York. 2025-03-09 09:00-17:00 EST (pre-DST). Party B: Australia/Sydney. 2025-03-09 15:00-23:00 AEDT (post-DST day in Sydney).
Request: start 2025-03-09T14:00Z end 2025-03-09T17:00Z (3 hours).
Party A (America/New_York, UTC-5): [2025-03-09T14:00Z, 2025-03-09T22:00Z]
Party B (Australia/Sydney, UTC+11): [2025-03-09T04:00Z, 2025-03-09T22:00Z]
Intersection: [2025-03-09T14:00Z, 2025-03-09T22:00Z] (hours 14-22 UTC).
Result: { ok: true, slots: [ { start: 2025-03-09T14:00Z, end: 2025-03-09T17:00Z } ] }
### Example 3: Counter-offer search
Party A (America/New_York): 2025-06-01 09:00-17:00 EST. Party B (Europe/London): 2025-06-01 14:00-22:00 BST. Request: 2025-06-01T13:00Z-16:00Z; no overlap (|2025-06-01T13:00Z - 2025-06-01T14:00Z| = 1h < 2h minimum). Counter-offer horizon 14 days, 15-minute step, same 3-hour duration, ranked by absolute distance from requested start.
### Example 4: Blackout dates
Party A (America/New_York): 2025-08-10 09:00-17:00. Party B (Europe/London): 2025-08-10 09:00-17:00. Blackout date for Party A: 2025-08-10. Request: 2025-08-10T13:00Z-15:00Z. 2025-08-10 09:00 EST = 13:00 UTC, so the request starts exactly on the blackout date.
Result: { ok: false, error: { code: blackout, message: "Request overlaps Party A blackout 2025-08-10" } }
### Example 5: end equal to start is rejected
Party A (America/New_York): 2025-11-01 09:00-17:00. Party B (Europe/London): 2025-11-01 09:00-17:00. Request: start 2025-11-01T13:00Z end 2025-11-01T13:00Z (zero duration).
Result: { ok: false, error: { code: invalid_interval, message: "end must be greater than start" } }
