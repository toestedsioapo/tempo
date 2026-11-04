const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * `--now` > `options.now` in the input > the clock (ADR 3, A-13, A-75).
 * Anything that is not a plain object (or has a non-object `options`) passes through unchanged so
 * core reports the error. The clock is called only when `now` is actually missing. Never mutates.
 */
export function withNow(input: unknown, flagNow: string | undefined, clockNow: () => string): unknown {
  if (!isPlainObject(input)) return input;
  const { options } = input;
  if (options === undefined) return { ...input, options: { now: flagNow ?? clockNow() } };
  if (!isPlainObject(options)) return input;
  if (flagNow !== undefined) return { ...input, options: { ...options, now: flagNow } };
  if ("now" in options) return input;
  return { ...input, options: { ...options, now: clockNow() } };
}
