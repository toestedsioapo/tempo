# Tempo

Cross-time-zone meeting negotiation: a deterministic TypeScript **library + CLI** that decides whether a meeting request fits everyone’s working hours (overnight shifts, DST, blackout dates) and, if it doesn’t, returns ranked counter-offers with reasons.

> **Status: implemented, not yet published.** The engine (`check`, `suggest`, `explain`), the CLI, the JSON Schema, an agent skill and examples are in this repository and tested on Windows (the Linux and Windows CI result follows the push). Nothing is on npm yet; the first release will be `v0.1.0`. Until then, run it from a clone (next section). See [ROADMAP.md](./ROADMAP.md).

## The pitch

Tempo answers one question: **“Given these people’s working hours, time zones and blackout dates, does this meeting slot work for all of them?”**

If it does, the decision is `book`. If not, it is `counter_offer`: why each person can’t make it, plus up to three alternative slots expressed unambiguously as ISO-8601 with offsets, ranked by how close they are to the time asked for.

It generalizes a working n8n **Meeting Scheduler**, where Gemini extracts `{day, start, end, requester time zone}` from an email, one party works an overnight shift (8 p.m.–6 a.m., so the window wraps midnight), and the flow books the slot or offers three alternatives in the requester’s local time. Tempo turns that code step into a tested, importable engine. It is the scheduling brain for later projects (Deskhand MCP, Deskbench, Deskflow).

## Why

- **Deterministic.** Same input, same output. `now` is an input; there is no hidden clock, network or randomness in the core.
- **DST-correct.** IANA zones via Luxon. A wall-clock time that doesn’t exist (spring forward) or occurs twice (fall back) is **rejected with a reason, never silently shifted**.
- **Never guesses.** `IST`, `CST`, `EST`… are ambiguous, so Tempo returns the candidate zones and exits `3` instead of picking one.
- **Overnight-aware.** An overnight shift belongs to the day it **starts** on. Blackouts and weekdays are read in each person’s own zone.
- **N participants.** Two or more people, not just two.
- **Agent-ready.** JSON in, JSON out, stable exit codes, no prompts. A tool-agnostic `SKILL.md` ships at the repo root.

## Install (once released)

```bash
# CLI (binary: tempo)
npm install -g @marvinliem/tempo

# Library
pnpm add @marvinliem/tempo-core
```

Try it without installing (works once `v0.1.0` is published):

```bash
npx @marvinliem/tempo@0.1.0 --version
```

Requires Node `>=24`. From source (this repo is a pnpm 12 workspace): `pnpm install`, `pnpm build`.

## Quick start from a clone

Requires Node `>=24` and pnpm 12. These commands work as written in Windows PowerShell and in bash:

```powershell
pnpm install
pnpm build
node packages/cli/dist/bin.js explain examples/demo.json --json
```

The last command prints the result shown in the demo below. In the commands that follow, `tempo` stands for `node packages/cli/dist/bin.js` until the package is published.

## Demo: `tempo explain`

Alice works in New York, 09:00–17:00 Monday to Friday. Bob works nights in Manila, 20:00–06:00 Monday to Friday. The requester is in Manila and asks for **Tuesday 2026-07-14, 10:00–11:00 Manila time**.

That instant is `2026-07-14T02:00Z`: Monday 22:00 in New York (EDT, −04:00), and outside Bob’s shift (his Monday-owned shift ended at 06:00 Tuesday Manila time). Neither can make it, so Tempo offers the nearest times that work for both.

The input is [`examples/demo.json`](./examples/demo.json):

```json
{
  "request": { "date": "2026-07-14", "start": "10:00", "end": "11:00", "timeZone": "Asia/Manila" },
  "participants": [
    {
      "partyId": "alice",
      "timeZone": "America/New_York",
      "weeklyRules": {
        "monday": [{ "start": "09:00", "end": "17:00" }],
        "tuesday": [{ "start": "09:00", "end": "17:00" }],
        "wednesday": [{ "start": "09:00", "end": "17:00" }],
        "thursday": [{ "start": "09:00", "end": "17:00" }],
        "friday": [{ "start": "09:00", "end": "17:00" }]
      },
      "blackouts": []
    },
    {
      "partyId": "bob",
      "timeZone": "Asia/Manila",
      "weeklyRules": {
        "monday": [{ "start": "20:00", "end": "06:00" }],
        "tuesday": [{ "start": "20:00", "end": "06:00" }],
        "wednesday": [{ "start": "20:00", "end": "06:00" }],
        "thursday": [{ "start": "20:00", "end": "06:00" }],
        "friday": [{ "start": "20:00", "end": "06:00" }]
      },
      "blackouts": []
    }
  ],
  "options": { "now": "2026-07-13T00:00:00Z" }
}
```

Then run it from a file or from stdin.

**bash**

```bash
tempo explain examples/demo.json --json
tempo explain --json < examples/demo.json
```

**Windows PowerShell** (this input is plain ASCII, so piping is safe; see the 5.1 note below for non-ASCII)

```powershell
tempo explain examples/demo.json --json
Get-Content examples/demo.json -Raw | tempo explain --json
```

**Output** (`options.now` is in the input file, so the result is reproducible; the exit code is `0`, or `1` with `--exit-code`, because the decision is `counter_offer`):

```json
{
  "ok": true,
  "decision": "counter_offer",
  "reasons": [
    { "code": "OUTSIDE_AVAILABILITY", "participantId": "alice", "message": "alice: requested interval is not inside any availability interval." },
    { "code": "OUTSIDE_AVAILABILITY", "participantId": "bob", "message": "bob: requested interval is not inside any availability interval." }
  ],
  "requested": {
    "slot": { "start": "2026-07-14T10:00:00+08:00", "end": "2026-07-14T11:00:00+08:00", "startUtc": "2026-07-14T02:00:00Z", "endUtc": "2026-07-14T03:00:00Z" },
    "pass": false,
    "timeGate": "OK",
    "checks": [
      { "participant": "alice", "ruleMatched": null, "pass": false, "reasonCode": "OUTSIDE_AVAILABILITY" },
      { "participant": "bob", "ruleMatched": null, "pass": false, "reasonCode": "OUTSIDE_AVAILABILITY" }
    ]
  },
  "candidates": [
    {
      "slot": { "start": "2026-07-14T04:00:00+08:00", "end": "2026-07-14T05:00:00+08:00", "startUtc": "2026-07-13T20:00:00Z", "endUtc": "2026-07-13T21:00:00Z" },
      "pass": true,
      "timeGate": "OK",
      "checks": [
        { "participant": "alice", "ruleMatched": { "weekday": "monday", "start": "09:00", "end": "17:00", "ownerDate": "2026-07-13" }, "pass": true, "reasonCode": "OK" },
        { "participant": "bob", "ruleMatched": { "weekday": "monday", "start": "20:00", "end": "06:00", "ownerDate": "2026-07-13" }, "pass": true, "reasonCode": "OK" }
      ]
    },
    {
      "slot": { "start": "2026-07-14T03:00:00+08:00", "end": "2026-07-14T04:00:00+08:00", "startUtc": "2026-07-13T19:00:00Z", "endUtc": "2026-07-13T20:00:00Z" },
      "pass": true,
      "timeGate": "OK",
      "checks": [
        { "participant": "alice", "ruleMatched": { "weekday": "monday", "start": "09:00", "end": "17:00", "ownerDate": "2026-07-13" }, "pass": true, "reasonCode": "OK" },
        { "participant": "bob", "ruleMatched": { "weekday": "monday", "start": "20:00", "end": "06:00", "ownerDate": "2026-07-13" }, "pass": true, "reasonCode": "OK" }
      ]
    },
    {
      "slot": { "start": "2026-07-14T02:00:00+08:00", "end": "2026-07-14T03:00:00+08:00", "startUtc": "2026-07-13T18:00:00Z", "endUtc": "2026-07-13T19:00:00Z" },
      "pass": true,
      "timeGate": "OK",
      "checks": [
        { "participant": "alice", "ruleMatched": { "weekday": "monday", "start": "09:00", "end": "17:00", "ownerDate": "2026-07-13" }, "pass": true, "reasonCode": "OK" },
        { "participant": "bob", "ruleMatched": { "weekday": "monday", "start": "20:00", "end": "06:00", "ownerDate": "2026-07-13" }, "pass": true, "reasonCode": "OK" }
      ]
    }
  ]
}
```

How to read it:

- `requested` failed for both people (`OUTSIDE_AVAILABILITY`).
- The three `candidates` are the suggestions, in **rank order** (distance from the requested start, ties earlier first), shown in the requester’s zone.
- Each candidate’s `checks` name the rule that matched. Both match rules **owned by Monday 2026-07-13**: Bob’s shift started Monday 20:00 Manila and runs into Tuesday morning.
- Suggestions never overlap one another: after ranking, Tempo skips any candidate that overlaps one it already picked (here the 19:45Z and 19:30Z starts were skipped, and 19:00Z and 18:00Z were taken instead). Slots that merely touch are fine.

The same input through `tempo check --json` returns the compact form (`decision`, `requested`, `slots`, `reasons`).

### Piping on Windows PowerShell 5.1

A file path is byte-exact everywhere, so prefer it. Windows PowerShell 5.1 re-encodes text it pipes to a program using `$OutputEncoding`, which is US-ASCII by default. A non-ASCII name such as `Zoë` is therefore damaged before Tempo sees it: `Get-Content f.json | tempo explain --json` gives `Zo??`, and even `Get-Content -Encoding UTF8 f.json | tempo explain --json` gives `Zo?`. This is a PowerShell limit, not a Tempo bug (measured on 5.1.26100; PowerShell 7 was not tested). Any of these works:

```powershell
tempo explain f.json --json
cmd /c "tempo explain --json < f.json"
$OutputEncoding = [System.Text.UTF8Encoding]::new($false); Get-Content -Encoding UTF8 f.json | tempo explain --json
```

Tempo also strips a leading UTF-8 byte-order mark and reads UTF-16 files that have one (what `>` and `Out-File` write in 5.1).

## Examples and agents

- [`examples/`](./examples/): the demo, one input per feature (overnight shift, DST, blackout, ambiguous zone, non-ASCII name), each validated against the generated [`schema/rules.schema.json`](./schema/rules.schema.json).
- [`examples/n8n/`](./examples/n8n/): an importable n8n workflow that calls `tempo check --json` from an Execute Command node and branches on the decision. It replaces the Code-node logic of the original Meeting Scheduler.
- [`SKILL.md`](./SKILL.md): a tool-agnostic skill that tells an agent how to drive the CLI, with example invocations and their exit codes.

## Library

```ts
import { evaluate } from "@marvinliem/tempo-core"

const result = evaluate({ request, participants, options: { now: "2026-07-13T00:00:00Z" } })
if (!result.ok) {
  // result.error.code: INVALID_INPUT | INVALID_ZONE | AMBIGUOUS_ZONE | INVALID_INTERVAL | DST_*_LOCAL_TIME
} else if (result.decision === "counter_offer") {
  // result.reasons, result.slots (ranked, up to 3)
}
```

Core never throws and never reads the clock.

## CLI

| Command | Purpose |
|---|---|
| `tempo check [file]` | Does the request fit everyone? `book` or `counter_offer` |
| `tempo suggest [file]` | Ranked alternative slots |
| `tempo explain [file]` | Per-candidate, per-participant trace |

Input is a JSON file or stdin. Flags: `--json` (machine output), `--exit-code`, `--now <ISO-8601 UTC>`, `--help`, `--version`.

**Exit codes** (public API):

| Code | Meaning |
|---|---|
| `0` | the computation succeeded (whatever the decision) |
| `1` | only with `--exit-code`: the decision is `counter_offer` (`book` stays `0`) |
| `2` | input error: bad JSON or fields, unknown zone, `start == end` rule, a request time that doesn’t exist or is ambiguous because of DST |
| `3` | ambiguous time-zone abbreviation (`IST`, `CST`, …); the JSON on stdout lists the candidate zones |
| `4` | internal error |

## Packages

| Package | Role | Publishes |
|---|---|---|
| `@marvinliem/tempo-core` | Pure engine: `evaluate`, `suggest`, `explain`, types, Zod schemas, fixtures | npm, with provenance |
| `@marvinliem/tempo` | CLI (`tempo` binary) | npm, with provenance |

## Documents

[SPEC.md](./SPEC.md) (types, semantics, 24 verified worked examples) · [ARCHITECTURE.md](./ARCHITECTURE.md) (toolchain, boundaries, ADRs) · [TEST_PLAN.md](./TEST_PLAN.md) (tests, properties, traceability) · [ROADMAP.md](./ROADMAP.md) · [DECISIONS.md](./DECISIONS.md) (locked decisions) · [ASSUMPTIONS.md](./ASSUMPTIONS.md)

## Contributing

Spec-first, test-first. No production code without a failing test, and one milestone task per branch. Plans live in `docs/plans/`.

## License

MIT
