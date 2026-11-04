import { parseArgs } from "node:util";

export type Command = "check" | "suggest" | "explain";
export type Parsed =
  | { kind: "help"; command: Command | undefined }
  | { kind: "version" }
  | {
      kind: "run";
      command: Command;
      file: string | undefined;
      json: boolean;
      exitCode: boolean;
      now: string | undefined;
    }
  /** `json`: whether `--json` was seen, so the error can honour it. */
  | { kind: "usage-error"; message: string; json: boolean };

const COMMANDS: readonly Command[] = ["check", "suggest", "explain"];
const isCommand = (s: string | undefined): s is Command => COMMANDS.includes(s as Command);

const OPTIONS = {
  json: { type: "boolean" },
  "exit-code": { type: "boolean" },
  now: { type: "string" },
  help: { type: "boolean", short: "h" },
  version: { type: "boolean" },
} as const;

/** `--json` anywhere before a `--` terminator; used when `parseArgs` itself throws (A-73). */
function sawJson(argv: string[]): boolean {
  const end = argv.indexOf("--");
  return (end === -1 ? argv : argv.slice(0, end)).includes("--json");
}

/** Only the first sentence: parseArgs appends a hint about `--` that does not apply here. */
function firstSentence(message: string): string {
  const i = message.indexOf(". ");
  return i === -1 ? message : message.slice(0, i + 1);
}

export function parseCli(argv: string[]): Parsed {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, allowPositionals: true, strict: true, tokens: true, options: OPTIONS });
  } catch (e) {
    return {
      kind: "usage-error",
      message: firstSentence(e instanceof Error ? e.message : String(e)),
      json: sawJson(argv),
    };
  }
  const json = parsed.values.json === true;

  const seen = new Set<string>();
  for (const t of parsed.tokens) {
    if (t.kind !== "option") continue;
    if (seen.has(t.name)) {
      return { kind: "usage-error", message: `Option '--${t.name}' was given more than once.`, json };
    }
    seen.add(t.name);
  }

  const [first, file, ...extra] = parsed.positionals;
  const command = isCommand(first) ? first : undefined;
  if (parsed.values.help === true) return { kind: "help", command };
  if (parsed.values.version === true) return { kind: "version" };

  if (first === undefined) return { kind: "usage-error", message: "Missing command (check, suggest or explain).", json };
  if (command === undefined) {
    return { kind: "usage-error", message: `Unknown command '${first}' (expected check, suggest or explain).`, json };
  }
  if (extra.length > 0) {
    return { kind: "usage-error", message: "Too many arguments (expected at most one input file).", json };
  }
  return {
    kind: "run",
    command,
    file: file === "-" ? undefined : file,
    json,
    exitCode: parsed.values["exit-code"] === true,
    now: parsed.values.now,
  };
}

const SUMMARY: Record<Command, string> = {
  check: "Decide whether the request fits everyone's working hours; if not, say why and offer counter-offers.",
  suggest: "Return ranked, non-overlapping slots that fit every participant.",
  explain: "Like check, plus a per-participant breakdown of every slot considered.",
};

const OPTION_LINES = [
  "Options:",
  "  --json          Print one JSON document on stdout (errors included, nothing on stderr).",
  "  --exit-code     Exit 1 instead of 0 when the decision is counter_offer.",
  "  --now <time>    Reference time, whole seconds in UTC, e.g. 2025-01-03T12:00:00Z.",
  "                  Overrides options.now in the input; the clock is the last resort.",
  "  -h, --help      Show this help.",
  "  --version       Show the version.",
];

const EXIT_LINES = [
  "Exit codes:",
  "  0  the computation succeeded, whatever the decision",
  "  1  --exit-code was given and the decision is counter_offer",
  "  2  input error (bad JSON, bad arguments, invalid request, DST gap or overlap)",
  "  3  ambiguous time zone abbreviation (the error lists the candidate zones)",
  "  4  internal error (a bug)",
];

export function helpText(command?: Command): string {
  const head =
    command === undefined
      ? [
          "tempo - decide whether a meeting fits everyone's working hours.",
          "",
          "Usage: tempo <command> [file] [options]",
          "",
          "Commands:",
          ...COMMANDS.map((c) => `  ${c.padEnd(8)}${SUMMARY[c]}`),
          "",
          "[file] is a JSON request; omit it or pass - to read stdin. Input is UTF-8 (BOM optional) or UTF-16 with a BOM.",
        ]
      : [`Usage: tempo ${command} [file] [options]`, "", SUMMARY[command], "", "[file] is a JSON request; omit it or pass - to read stdin."];
  return [...head, "", ...OPTION_LINES, "", ...EXIT_LINES, ""].join("\n");
}
