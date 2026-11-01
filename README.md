# Tempo

Cross-time-zone meeting negotiation — a deterministic TypeScript library + CLI.

## The Pitch

Tempo answers one question: **"Given two people's working hours, time zones, and blackout dates, does this meeting slot work for both of them?"**

If not, Tempo returns up to three alternative slots where both parties overlap — expressed unambiguously as ISO-8601 with offsets.

It generalizes a production n8n "Meeting Scheduler" where one party works an overnight shift (8 p.m. → 6 a.m., wrapping midnight) and the other works standard daytime hours. Tempo makes that logic pure, testable, and importable by downstream projects (MCP server, agent eval harness, SaaS dashboard).

## Why

- **Deterministic:** Same inputs always produce the same output. No hidden clock, no network, no guesses.
- **DST-safe:** IANA zones with Luxon. Spring-forward gaps and fall-back ambiguities are rejected or documented — never silently shifted.
- **Overnight-aware:** An 8 p.m.–6 a.m. window belongs to its start day and is evaluated across the calendar boundary correctly.
- **AI-friendly:** JSON in/out, stable exit codes (0/1/2/3), no interactive prompts — pipes and scripts welcome.
- **Importable:** `@tempo/core` is a pure TypeScript library; later projects consume it directly.

## Install

```bash
# Locally (this repo is a pnpm workspace)
pnpm install

# Use the CLI
pnpm --filter @tempo/cli tempo check --help
```

Published packages (after Milestone 6):

```bash
npm install -g @tempo/cli
tempo check --help
```

## Demo: `tempo explain`

A concrete, reproducible example: party A (America/New_York) works a regular 09:00–17:00 window; party B (Europe/London) works an overnight shift from 20:00 Monday to 06:00 Tuesday. Requesting Monday 22:00–23:00 (America/New_York, 02:00–03:00 UTC) is free for A but Party B's Monday evening is dead — the counter-offer is Tuesday 19:00–20:00 (America/New_York), which falls inside both parties' hours.

```bash
$ cat > tempo-demo.json <<'EOF'
{
  "request": {
    "date": "2026-07-13",
    "start": "22:00",
    "end": "23:00",
    "requesterTimeZone": "America/New_York",
    "partyA": {
      "timeZone": "America/New_York",
      "weeklyRules": { "monday": [{ "start": "09:00", "end": "17:00" }] },
      "blackoutDates": []
    },
    "partyB": {
      "timeZone": "Europe/London",
      "weeklyRules": { "monday": [{ "start": "20:00", "end": "06:00" }] },
      "blackoutDates": []
    },
    "now": "2026-07-13T00:00:00Z"
  }
}
EOF
$ tempo explain tempo-demo.json
```

**Mocked output:**

```json
{
  "decision": "counter_offer",
  "candidate": {
    "start": "2026-07-13T19:00:00-04:00",
    "end": "2026-07-13T20:00:00-04:00"
  },
  "reasons": [
    "Party B unavailable 22:00–23:00 on Monday (working hours 09:00–17:00)"
  ],
  "slots": [
    {
      "start": "2026-07-14T15:00:00-04:00",
      "end": "2026-07-14T16:00:00-04:00"
    }
  ]
}
```

Exit code: `1` (counter_offer).

The slot `2026-07-14T15:00:00-04:00` is inside both parties' hours: Monday 09:00–17:00 for A and Tuesday 20:00–06:00 for B (wrapped midnight).

## CLI Commands

| Command | Purpose | Exit Codes |
|---------|---------|------------|
| `tempo check` | Is this slot bookable for both parties? | 0 = book, 1 = counter_offer, 2 = error, 3 = ambiguous zone |
| `tempo suggest` | Generate up to 3 alternative slots | 0 = slots found, 1 = no slots, 2 = error, 3 = ambiguous zone |
| `tempo explain` | Why did each candidate slot pass or fail? | 0 / 1 / 2 / 3 |

## Packages

| Package | Role | Publishes |
|---------|------|-----------|
| `@tempo/core` | Pure negotiation math | Yes (npm, with provenance) |
| `@tempo/cli` | CLI (`tempo` binary) | Yes (npm, with provenance) |

## Roadmap

Six weekly milestones ending in an npm release with provenance. See [ROADMAP.md](./ROADMAP.md).

## Contributing

Spec-first, test-first. No implementation without an approved spec and test plan. See [ARCHITECTURE.md](./ARCHITECTURE.md) and [TEST_PLAN.md](./TEST_PLAN.md).

## License

MIT
