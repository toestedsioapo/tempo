---
name: tempo
description: Decide whether a meeting request fits every participant's working hours (time zones, overnight shifts, DST, blackout dates) and, if not, get ranked non-overlapping counter-offers with reasons. Use the `tempo` CLI with JSON in and JSON out.
---

# Tempo

Tempo is a deterministic CLI. You give it one JSON request (a meeting time and each participant's weekly
working hours, time zone and blackout dates). It answers `book` or `counter_offer`, and for a counter-offer it
lists up to three alternative slots and the reason each person could not attend. It never prompts, never
reads the network, and gives the same output for the same input.

## When to use

- You must check a proposed meeting time against two or more people in different time zones.
- You need alternative times that work for everyone, with the reasons the first choice failed.
- You need an auditable trace of which availability rule matched for each person (`explain`).

Do not use it to read calendars or send invitations; it only decides.

## Run it

If the package is installed: `tempo`. From a clone of the repository (after `pnpm install` and `pnpm build`):
`node packages/cli/dist/bin.js`. The examples below write `tempo` for either.

## Input

One JSON object: `request` (`date`, `start`, `end`, `timeZone`), `participants[]` (`partyId`, `timeZone`,
`weeklyRules`, `blackouts`) and optional `options` (`now`, `minNoticeMinutes`, `searchHorizonDays`,
`searchStepMinutes`, `maxSuggestions`). The input is a file path, or stdin when no path (or `-`) is given.
The JSON Schema is `schema/rules.schema.json` (also shipped in the package as
`@marvinliem/tempo-core/rules.schema.json`); working inputs are in `examples/`.

Always give `options.now` (or `--now <UTC instant>`, whole seconds, ending in `Z`). Without it Tempo reads
the real clock, so the result changes over time.

## Commands

Each line shows the command and its exit code after `# exit:`.

```bash
tempo check examples/inputs/overnight.json --json                    # exit: 0
tempo check examples/demo.json --json --exit-code                    # exit: 1
tempo suggest examples/demo.json --json                              # exit: 0
tempo explain examples/demo.json --json                              # exit: 0
tempo explain --json < examples/demo.json                            # exit: 0
cat examples/demo.json | tempo check --json                          # exit: 0
tempo check examples/inputs/ambiguous-zone.json --json               # exit: 3
echo '{}' | tempo check --json                                       # exit: 2
```

- `check` returns the compact decision: `decision`, `requested`, `reasons`, `slots`.
- `suggest` returns the ranked alternatives (on a `book`, slot 1 is the requested slot).
- `explain` returns the per-candidate, per-participant trace.
- `--json` prints one JSON document on stdout, errors included, and nothing on stderr. Without it the output
  is human-readable text.

## Reading the result

- `ok: true` and `decision: "book"`: the request fits everyone. `decision: "counter_offer"`: it does not.
- `reasons[].code` says why (for example `OUTSIDE_AVAILABILITY`, `IN_BLACKOUT`, `IN_PAST`,
  `INSUFFICIENT_NOTICE`, `NO_SLOTS_IN_HORIZON`) and `reasons[].participantId` says whose.
- `slots[]` are ranked by closeness to the requested start, never overlap each other, and carry the local
  `start` / `end` plus `startUtc` / `endUtc`.
- `ok: false` carries `error.code` and `error.message`; for `AMBIGUOUS_ZONE`, `error.details.options` lists
  the candidate IANA zones.

## Exit codes

| Code | Meaning |
|---|---|
| `0` | the computation succeeded, whatever the decision |
| `1` | only with `--exit-code`: the decision is `counter_offer` (`book` stays `0`) |
| `2` | input error: bad JSON or fields, unknown zone, a request time that does not exist or is ambiguous because of DST |
| `3` | ambiguous time-zone abbreviation (`IST`, `CST`, ...); choose an IANA zone and retry |
| `4` | internal error |

A `counter_offer` is a normal answer, not an error: branch on `decision`, and add `--exit-code` only when
you want the shell to see it.

## Pipes and Windows

Prefer a file path: it is byte-exact on every platform. Windows PowerShell 5.1 re-encodes text it pipes to
a program with `$OutputEncoding`, which is US-ASCII by default, so a non-ASCII name such as `Zoë` is damaged
before Tempo sees it: `Get-Content f.json | tempo explain --json` gives `Zo??` (`ZoÃ«` once `$OutputEncoding` is UTF-8), and even
`Get-Content -Encoding UTF8 f.json | tempo explain --json` gives `Zo?` unless `$OutputEncoding` is also set.
That is a PowerShell limit, not a Tempo bug (measured on 5.1.26100). Use one of these instead:

```powershell
tempo explain f.json --json
cmd /c "tempo explain --json < f.json"
$OutputEncoding = [System.Text.UTF8Encoding]::new($false); Get-Content -Encoding UTF8 f.json | tempo explain --json
```

Plain ASCII requests pipe correctly with any of these. Tempo strips a leading UTF-8 byte-order mark and also
reads UTF-16 files that have one (what `>` and `Out-File` write in 5.1). PowerShell 7 was not tested.

## Do not

- Never guess an ambiguous zone. On exit `3`, pick one of `error.details.options` and rerun with the IANA
  name.
- Do not retry exit `2` or `3` with the same input; change the input.
- Do not parse the human-readable output; it is not stable. Use `--json`.
- Do not hand-edit `schema/rules.schema.json`; it is generated.
