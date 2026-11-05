# Examples

Every JSON input here is validated against the generated `schema/rules.schema.json` in CI
(`packages/core/test/example-files.test.ts`). Commands below run from the repository root after
`pnpm install` and `pnpm build`; `tempo` means `node packages/cli/dist/bin.js` until the package is published.

| File | What it shows | Command | Exit |
|---|---|---|---|
| `demo.json` | The README demo: New York 09:00-17:00 and a Manila night shift (20:00-06:00) | `tempo explain examples/demo.json --json` | `0` |
| `demo.explain.json` | The exact output of the command above (an expected output, not an input) | | |
| `inputs/overnight.json` | An overnight shift: the request falls in the wrapped part (SPEC EX-05) | `tempo check examples/inputs/overnight.json` | `0` |
| `inputs/dst-spring-forward.json` | Midnight wrap across a Europe/Berlin DST change (EX-14) | `tempo check examples/inputs/dst-spring-forward.json` | `0` |
| `inputs/blackout.json` | A blackout day forces a counter-offer (EX-04) | `tempo check examples/inputs/blackout.json` | `0` (`1` with `--exit-code`) |
| `inputs/ambiguous-zone.json` | Zone `IST` is ambiguous: Tempo never guesses (EX-23) | `tempo check examples/inputs/ambiguous-zone.json --json` | `3` |
| `inputs/non-ascii-party.json` | A non-ASCII `partyId` (`Zoë`); use it to test piping on Windows PowerShell 5.1 | `tempo check examples/inputs/non-ascii-party.json` | `0` |
| `n8n/` | An importable n8n workflow that calls `tempo check --json` | see `n8n/README.md` | |

`demo.explain.json` is regenerated with `tempo explain examples/demo.json --json > examples/demo.explain.json`
and committed only after reading it.

## Windows PowerShell 5.1 and `non-ascii-party.json`

Measured on Windows PowerShell 5.1.26100 (default `$OutputEncoding` is US-ASCII), the `partyId` `Zoë` arrives as:

| Command | Result |
|---|---|
| `tempo explain f.json --json` | `Zoë` |
| `cmd /c "tempo explain --json < f.json"` | `Zoë` |
| `Get-Content f.json | tempo explain --json` | `Zo??` (damaged by PowerShell) |
| `Get-Content -Encoding UTF8 f.json | tempo explain --json` | `Zo?` (damaged by PowerShell) |
| `$OutputEncoding = [System.Text.UTF8Encoding]::new($false); Get-Content -Encoding UTF8 f.json | tempo explain --json` | `Zoë` |

This is a PowerShell limit, not a Tempo bug. Prefer the file path.
