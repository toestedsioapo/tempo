import { describe, expect, it } from "vitest";
import {
  ClockTimeSchema,
  DAY_NAMES,
  DayNameSchema,
  EndTimeSchema,
  LocalDateSchema,
  UtcInstantSchema,
  ZoneIdSchema,
} from "./schema.js";

const table = (cases: [string, boolean][]) => cases;

describe("LocalDateSchema", () => {
  it.each(
    table([
      ["2025-01-06", true],
      ["2024-02-29", true],
      ["2025-02-29", false],
      ["2025-02-30", false],
      ["2025-13-01", false],
      ["2025-1-6", false],
      ["25-01-06", false],
      [" 2025-01-06", false],
    ]),
  )("%j -> %s", (v, expected) => {
    expect(LocalDateSchema.safeParse(v).success).toBe(expected);
  });
});

describe("ClockTimeSchema", () => {
  it.each(
    table([
      ["00:00", true],
      ["09:30", true],
      ["23:59", true],
      ["24:00", false],
      ["9:00", false],
      ["09:60", false],
      ["09:00:00", false],
      [" 09:00", false],
    ]),
  )("%j -> %s", (v, expected) => {
    expect(ClockTimeSchema.safeParse(v).success).toBe(expected);
  });
});

describe("EndTimeSchema", () => {
  it.each(
    table([
      ["24:00", true],
      ["23:59", true],
      ["25:00", false],
      ["24:01", false],
    ]),
  )("%j -> %s", (v, expected) => {
    expect(EndTimeSchema.safeParse(v).success).toBe(expected);
  });
});

describe("UtcInstantSchema", () => {
  it.each(
    table([
      ["2025-01-03T12:00:00Z", true],
      ["2025-01-03T12:00:00.000Z", false],
      ["2025-01-03T12:00:00+00:00", false],
      ["2025-01-03T12:00Z", false],
      ["2025-02-30T12:00:00Z", false],
    ]),
  )("%j -> %s", (v, expected) => {
    expect(UtcInstantSchema.safeParse(v).success).toBe(expected);
  });
});

describe("DayNameSchema", () => {
  it.each([...DAY_NAMES.map((d): [string, boolean] => [d, true]),
    ["Monday", false], ["mon", false], ["1", false]] as [string, boolean][])(
    "%j -> %s",
    (v, expected) => {
      expect(DayNameSchema.safeParse(v).success).toBe(expected);
    },
  );
  it("has seven days starting monday", () => {
    expect(DAY_NAMES).toHaveLength(7);
    expect(DAY_NAMES[0]).toBe("monday");
  });
});

describe("ZoneIdSchema", () => {
  it("accepts non-empty strings, rejects empty", () => {
    expect(ZoneIdSchema.safeParse("Europe/Berlin").success).toBe(true);
    expect(ZoneIdSchema.safeParse("").success).toBe(false);
  });
});
