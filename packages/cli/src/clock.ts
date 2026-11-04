/** The only reader of the system clock in the CLI (CLI-10). Whole-second UTC, truncated, never rounded (A-17). */
export function systemNow(): string {
  return `${new Date().toISOString().slice(0, 19)}Z`;
}
