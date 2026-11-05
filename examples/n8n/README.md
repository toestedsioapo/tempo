# n8n: Meeting Scheduler on top of `tempo check --json`

An importable workflow that replaces the Code-node logic of the original Meeting Scheduler (convert the
request to each person's local time, check working-hours windows, offer alternatives). The workflow writes
the request to a file, runs `tempo check <file> --json`, and branches on the `decision`.

```
Manual Trigger -> Settings -> Build request -> Request to file -> Write request file
   -> Tempo check -> Parse result -> Decision --book----------------> Book slot
                                              --counter_offer-------> Offer alternatives
                                              --error (fallback)----> Report input error
```

In the original flow, the node that extracts `{day, start, end, requester time zone}` from an email (Gemini)
feeds **Build request**: replace its `requestJson` value with an expression that builds the Tempo request
(see `examples/demo.json` for the shape). **Book slot** and **Offer alternatives** are `NoOp` placeholders
where a calendar node plugs in; `{{ $json.result.slots }}` holds the ranked alternatives and
`{{ $json.result.reasons }}` the reason per person.

## Before you import

1. **Enable the Execute Command node.** n8n excludes `n8n-nodes-base.executeCommand` by default, because it
   runs arbitrary shell commands on the host. Enable it only on an instance you control:
   `NODES_EXCLUDE=[]` (this also re-enables Local File Trigger; list only what you want to keep excluded).
2. **Put the request file where n8n may write.** n8n restricts file access to `~/.n8n-files`
   (`N8N_RESTRICT_FILE_ACCESS_TO`). `/tmp` is refused, and does not exist on Windows.
3. **Use absolute paths.** Execute Command spawns with `shell: true` and the working directory of the n8n
   process (`cmd.exe` on Windows). Edit the **Settings** node once:

   | Field | Linux / Docker | Windows |
   |---|---|---|
   | `tempoRequestPath` | `/home/node/.n8n-files/tempo-request.json` (Docker) or `/home/<you>/.n8n-files/tempo-request.json` | `C:\Users\<you>\.n8n-files\tempo-request.json` |
   | `tempoCommand` | `tempo` | `tempo`, or `node "C:\path\to\tempo\packages\cli\dist\bin.js"` from a clone |

4. **`tempo` must be on the n8n host's `PATH`** (`npm install -g @marvinliem/tempo` once released), or use the
   `node ...bin.js` form from a clone after `pnpm install && pnpm build`.

Import with *Workflows -> Import from File*.

## Why the command ends with `|| exit 0`

Tempo exits `2` for an input error and `3` for an ambiguous zone. n8n turns any non-zero exit into a failed
node whose output keeps only `error: "Command failed with exit code 3"`: the JSON error document (with the
candidate zones for `AMBIGUOUS_ZONE`) is lost. `|| exit 0` works in both `sh` and `cmd.exe`, keeps Tempo's
stdout, and lets the **Decision** node route on the JSON instead: `ok: false` goes to the `error` output with
`result.error.code` and `result.error.message`. A `counter_offer` is exit `0` anyway (D14), so the flow
never uses `--exit-code`. If `tempo` itself cannot be started, stdout is empty and **Parse result** produces
`error.code = "NO_OUTPUT"` carrying stderr.

## Verified

Run by `node examples/n8n/verify.mjs` with the global `n8n` CLI (2.38.7) in a throw-away
`N8N_USER_FOLDER`, `NODES_EXCLUDE=[]` and `N8N_RESTRICT_FILE_ACCESS_TO` set to a scratch folder. For each
case the workflow is imported (with the Settings paths and the request patched in) and executed. Results are
pinned in `verified.json`:

| Request | Branch that ran | Result |
|---|---|---|
| EX-01 | Book slot | `decision: book` |
| EX-17 | Offer alternatives | `decision: counter_offer` |
| EX-23 | Report input error | `error.code: AMBIGUOUS_ZONE`, 3 candidate zones |

Limits, stated plainly: the checked-in file itself (with its placeholder Linux path) was not executed; the
verified copies differ only in the three patched values. Only n8n 2.38.7 on Windows was tried. Node
`typeVersion`s are the ones n8n 2.38.7 offers (Execute Command 1, Read/Write Files 1.1, Convert to File 1.1,
Switch 3.4, Edit Fields 3.4). `packages/cli/test/n8n.test.ts` checks the file's structure and that the pinned results still agree
with the CLI, but cannot run n8n.
