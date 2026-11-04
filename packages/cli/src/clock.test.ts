import { afterEach, describe, expect, it, vi } from "vitest";
import { systemNow } from "./clock.js";

afterEach(() => vi.useRealTimers());

describe("systemNow", () => {
  it("is a whole-second UTC instant", () => {
    expect(systemNow()).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
  });

  it("truncates milliseconds instead of rounding", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-01T10:20:30.987Z"));
    expect(systemNow()).toBe("2026-03-01T10:20:30Z");
  });
});
