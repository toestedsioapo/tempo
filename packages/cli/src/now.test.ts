import { describe, expect, it, vi } from "vitest";
import { withNow } from "./now.js";

const CLOCK = "2030-01-01T00:00:00Z";
const FLAG = "2025-01-03T12:00:00Z";
const FILE = "2024-06-01T00:00:00Z";
const clock = () => vi.fn(() => CLOCK);

describe("withNow (--now > options.now > clock)", () => {
  it("the flag beats the file", () => {
    const c = clock();
    const out = withNow({ options: { now: FILE, maxSuggestions: 2 } }, FLAG, c) as { options: Record<string, unknown> };
    expect(out.options).toEqual({ now: FLAG, maxSuggestions: 2 });
    expect(c).not.toHaveBeenCalled();
  });

  it("the file beats the clock, and the clock is not called", () => {
    const c = clock();
    const input = { options: { now: FILE } };
    expect(withNow(input, undefined, c)).toBe(input);
    expect(c).not.toHaveBeenCalled();
  });

  it("the clock is used when neither is given, and called once", () => {
    const c = clock();
    const out = withNow({ options: { maxSuggestions: 2 } }, undefined, c) as { options: Record<string, unknown> };
    expect(out.options).toEqual({ maxSuggestions: 2, now: CLOCK });
    expect(c).toHaveBeenCalledTimes(1);
  });

  it("adds options when absent", () => {
    const out = withNow({ request: {} }, undefined, clock());
    expect(out).toEqual({ request: {}, options: { now: CLOCK } });
  });

  it("a present now key is never overwritten by the clock, even null", () => {
    const c = clock();
    const input = { options: { now: null } };
    expect(withNow(input, undefined, c)).toBe(input);
    expect(c).not.toHaveBeenCalled();
  });

  it("the flag does overwrite a present null", () => {
    const out = withNow({ options: { now: null } }, FLAG, clock()) as { options: { now: unknown } };
    expect(out.options.now).toBe(FLAG);
  });

  it.each([null, [], 42, "x", true, { options: 5 }, { options: [] }, { options: null }])(
    "passes %j through unchanged (core reports the error)",
    (input) => {
      const c = clock();
      expect(withNow(input, FLAG, c)).toBe(input);
      expect(withNow(input, undefined, c)).toBe(input);
      expect(c).not.toHaveBeenCalled();
    },
  );

  it("does not mutate its input", () => {
    const input = { options: { maxSuggestions: 2 } };
    const before = JSON.parse(JSON.stringify(input)) as unknown;
    withNow(input, FLAG, clock());
    withNow({}, undefined, clock());
    expect(input).toEqual(before);
  });
});

describe("withNow: review additions (M4 Task 1)", () => {
  it("the flag creates options when the input has none, without reading the clock", () => {
    const c = clock();
    expect(withNow({}, FLAG, c)).toEqual({ options: { now: FLAG } });
    expect(c).not.toHaveBeenCalled();
  });

  it("the clock branch does not mutate an existing options object", () => {
    const options = { maxSuggestions: 2 };
    const input = { options };
    const out = withNow(input, undefined, clock()) as { options: Record<string, unknown> };
    expect(out.options).toEqual({ maxSuggestions: 2, now: CLOCK });
    expect(options).toEqual({ maxSuggestions: 2 });
    expect(input.options).toBe(options);
  });
});
