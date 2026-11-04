import type { ErrorResult } from "@marvinliem/tempo-core";

/** `--json` output: pretty-printed, one trailing newline, no BOM (A-77). */
export function renderJson(result: unknown): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}

/** One human-readable error line, without the trailing newline (A-77). */
export function renderErrorLine(error: ErrorResult["error"]): string {
  return `tempo: ${error.code}: ${error.message.replace(/\s*[\r\n]+\s*/g, " ")}`;
}
