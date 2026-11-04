import type {
  CandidateTrace,
  ErrorResult,
  ExplainResult,
  IsoSlot,
  NegotiationOk,
  Reason,
  RuleRef,
} from "@marvinliem/tempo-core";
import type { Command } from "./args.js";

/** `--json` output: pretty-printed, one trailing newline, no BOM (A-77). */
export function renderJson(result: unknown): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}

/** One human-readable error line, without the trailing newline (A-77). */
export function renderErrorLine(error: ErrorResult["error"]): string {
  return `tempo: ${error.code}: ${error.message.replace(/\s*[\r\n]+\s*/g, " ")}`;
}

export type ExplainOk = Extract<ExplainResult, { ok: true }>;
export type HumanResult = NegotiationOk | ExplainOk;

const slotLine = (s: IsoSlot): string => `${s.start} -> ${s.end}  (${s.startUtc} -> ${s.endUtc})`;

function ruleText(rule: RuleRef | null): string {
  return rule === null ? "-" : `${rule.weekday} ${rule.start}-${rule.end} (${rule.ownerDate})`;
}

function reasonLines(reasons: Reason[]): string[] {
  return reasons.length === 0 ? [] : ["Reasons:", ...reasons.map((r) => `  - ${r.code}  ${r.message}`)];
}

function slotBlock(slots: IsoSlot[]): string[] {
  return slots.length === 0
    ? ["No alternative slot found."]
    : ["Suggested slots:", ...slots.map((s, i) => `  ${i + 1}. ${slotLine(s)}`)];
}

function traceLines(heading: string, trace: CandidateTrace): string[] {
  return [
    "",
    heading,
    slotLine(trace.slot),
    `Time gate: ${trace.timeGate}`,
    ...trace.checks.map(
      (c) => `  ${c.participant}: ${c.pass ? "PASS" : "FAIL"}  ${c.reasonCode}  ${ruleText(c.ruleMatched)}`,
    ),
  ];
}

/**
 * Human-readable text for `check`, `suggest` and `explain` (A-13: not public API, pinned by snapshots).
 * ASCII-only apart from text copied from the input; no colour, no terminal-width logic.
 */
export function renderHuman(command: Command, result: HumanResult): string {
  const lines: string[] = [`Decision: ${result.decision}`];
  if ("candidates" in result) {
    lines.push(`Requested: ${slotLine(result.requested.slot)}`, ...reasonLines(result.reasons));
    lines.push(...traceLines("Requested slot", result.requested));
    result.candidates.forEach((c, i) => lines.push(...traceLines(`Candidate ${i + 1}`, c)));
  } else {
    lines.push(`Requested: ${slotLine(result.requested)}`, ...reasonLines(result.reasons));
    if (command === "suggest" || result.decision === "counter_offer") lines.push(...slotBlock(result.slots));
  }
  return `${lines.join("\n")}\n`;
}
