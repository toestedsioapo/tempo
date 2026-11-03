import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Extracts the 24 worked examples from SPEC.md section 6 into fixtures/examples/ex-nn.json.
// `input` is built from the Input bullet list; `expected` is the Output JSON block, parsed and re-serialised.
// Any unrecognised Input bullet throws with the example id and the line. Non-bullet prose lines are ignored.

const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;
type Interval = { start: string; end: string };

function fail(id: string, line: string, why: string): never {
  throw new Error(`${id}: ${why}: ${line}`);
}

function expandDays(id: string, spec: string, line: string): string[] {
  const parts = spec.split("–");
  const idx = (name: string): number => {
    const i = DAYS.indexOf(name as (typeof DAYS)[number]);
    if (i < 0) fail(id, line, `unknown weekday "${name}"`);
    return i;
  };
  if (parts.length === 1) return [DAYS[idx(parts[0] ?? "")] as string];
  if (parts.length !== 2) fail(id, line, "bad weekday range");
  const from = idx(parts[0] ?? "");
  const to = idx(parts[1] ?? "");
  if (to < from) fail(id, line, "weekday range goes backwards");
  return DAYS.slice(from, to + 1);
}

function parseRules(id: string, text: string, line: string): Record<string, Interval[]> {
  const rules: Record<string, Interval[]> = {};
  for (const segment of text.split(";")) {
    const m = /^\s*([a-z]+(?:–[a-z]+)?)\s+(\d\d:\d\d–\d\d:\d\d(?:\s*,\s*\d\d:\d\d–\d\d:\d\d)*)\s*$/.exec(segment);
    if (!m) fail(id, line, "unrecognised weeklyRules segment");
    const intervals: Interval[] = (m[2] as string).split(",").map((p) => {
      const [start, end] = p.trim().split("–");
      return { start: start as string, end: end as string };
    });
    for (const day of expandDays(id, m[1] as string, line)) {
      rules[day] = intervals.map((i) => ({ ...i }));
    }
  }
  return rules;
}

function parseOptions(id: string, text: string, line: string): Record<string, unknown> {
  const options: Record<string, unknown> = {};
  for (const pair of text.split(",")) {
    const m = /^\s*(now|minNoticeMinutes|searchHorizonDays)=(?:`([^`]+)`|(\d+))\s*$/.exec(pair);
    if (!m) fail(id, line, "unrecognised option");
    options[m[1] as string] = m[2] !== undefined ? m[2] : Number(m[3]);
  }
  return options;
}

function parseInput(id: string, lines: string[]): unknown {
  let request: unknown;
  const participants: unknown[] = [];
  let options: Record<string, unknown> | undefined;
  for (const line of lines) {
    let m: RegExpExecArray | null;
    if ((m = /^- request: `([\d-]{10})` `(\d\d:\d\d)`→`(\d\d:\d\d)` in `([^`]+)`$/.exec(line))) {
      request = { date: m[1], start: m[2], end: m[3], timeZone: m[4] };
    } else if (
      (m = /^- `([^`]+)` — `([^`]+)` — weeklyRules: (.+?)(?: — blackouts: ([\d, -]+))?$/.exec(line))
    ) {
      const participant: Record<string, unknown> = {
        partyId: m[1],
        timeZone: m[2],
        weeklyRules: parseRules(id, m[3] as string, line),
      };
      if (m[4] !== undefined) participant["blackouts"] = m[4].split(",").map((d) => d.trim());
      participants.push(participant);
    } else if ((m = /^- options: (.+?)(?: \(other options at defaults\))?$/.exec(line))) {
      options = parseOptions(id, m[1] as string, line);
    } else {
      fail(id, line, "unrecognised Input line");
    }
  }
  if (!request) fail(id, "(none)", "missing request line");
  if (participants.length < 2) fail(id, "(none)", "fewer than two participant lines");
  if (!options) fail(id, "(none)", "missing options line");
  return { request, participants, options };
}

export function extractFixtures(specText: string): { id: string; json: string }[] {
  const text = specText.replace(/\r\n/g, "\n");
  const headings = [...text.matchAll(/^### (EX-\d\d) — .*$/gm)];
  return headings.map((h, i) => {
    const id = h[1] as string;
    const chunk = text.slice(h.index, headings[i + 1]?.index ?? text.length);
    const lines = chunk.split("\n");
    const inputAt = lines.indexOf("**Input**");
    if (inputAt < 0) fail(id, "**Input**", "heading not found");
    const inputLines: string[] = [];
    for (const raw of lines.slice(inputAt + 1)) {
      if (raw.startsWith("**")) break;
      if (raw.startsWith("- ")) inputLines.push(raw.trimEnd());
    }
    const outAt = lines.findIndex((l) => l.startsWith("**Output**"));
    if (outAt < 0) fail(id, "**Output**", "heading not found");
    const entry = /^\*\*Output\*\* \(`explain`\)/.test(lines[outAt] as string) ? "explain" : "evaluate";
    const open = lines.findIndex((l, j) => j > outAt && l === "```json");
    const close = lines.findIndex((l, j) => j > open && l === "```");
    if (open < 0 || close < 0) fail(id, "```json", "Output block not found");
    const expected: unknown = JSON.parse(lines.slice(open + 1, close).join("\n"));
    const fixture = { id, entry, input: parseInput(id, inputLines), expected };
    return { id, json: JSON.stringify(fixture, null, 2) + "\n" };
  });
}

// Run directly: write fixtures next to the tests (LF endings; writeFileSync does not translate).
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = resolve(import.meta.dirname, "../../..");
  const outDir = resolve(import.meta.dirname, "../fixtures/examples");
  mkdirSync(outDir, { recursive: true });
  for (const { id, json } of extractFixtures(readFileSync(join(root, "SPEC.md"), "utf8"))) {
    writeFileSync(join(outDir, `${id.toLowerCase()}.json`), json);
  }
}
