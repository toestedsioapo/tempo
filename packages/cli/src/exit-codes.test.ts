import { describe, expect, it } from "vitest";
import { EXIT, exitCodeForError } from "./exit-codes.js";

describe("EXIT", () => {
  it("is the public exit-code contract", () => {
    expect(EXIT).toStrictEqual({
      OK: 0,
      COUNTER_OFFER: 1,
      INPUT_ERROR: 2,
      AMBIGUOUS_ZONE: 3,
      INTERNAL_ERROR: 4,
    });
  });
});

describe("exitCodeForError", () => {
  it.each([
    ["INVALID_INPUT", 2],
    ["INVALID_ZONE", 2],
    ["INVALID_INTERVAL", 2],
    ["DST_NONEXISTENT_LOCAL_TIME", 2],
    ["DST_AMBIGUOUS_LOCAL_TIME", 2],
    ["AMBIGUOUS_ZONE", 3],
    ["INTERNAL_ERROR", 4],
  ] as const)("%s -> %i", (code, expected) => {
    expect(exitCodeForError(code)).toBe(expected);
  });

  it("maps all 7 codes to 2, 3 or 4", () => {
    const all = [
      "INVALID_INPUT",
      "INVALID_ZONE",
      "AMBIGUOUS_ZONE",
      "INVALID_INTERVAL",
      "DST_NONEXISTENT_LOCAL_TIME",
      "DST_AMBIGUOUS_LOCAL_TIME",
      "INTERNAL_ERROR",
    ] as const;
    expect(all).toHaveLength(7);
    for (const code of all) {
      expect([2, 3, 4]).toContain(exitCodeForError(code));
    }
  });
});
