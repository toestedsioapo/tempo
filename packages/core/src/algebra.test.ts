import { describe, it, expect } from "vitest";
import { intersectLocal, subtractLocal } from "./algebra";
import { localToIso, decide, type LocalInterval, type Iso, type DecisionResult, type IsoSlot } from "./decision";

describe("Interval Algebra", () => {
  describe("intersectLocal", () => {
    it("returns null when intervals don't overlap", () => {
      const a: LocalInterval = { zone: "America/New_York", start: "09:00", end: "10:00" };
      const b: LocalInterval = { zone: "America/New_York", start: "11:00", end: "12:00" };
      const result = intersectLocal(a, b);
      expect(result).toBeNull();
    });

    it("returns the overlapping interval when intervals partially overlap", () => {
      const a: LocalInterval = { zone: "America/New_York", start: "09:00", end: "11:00" };
      const b: LocalInterval = { zone: "America/New_York", start: "10:00", end: "12:00" };
      const result = intersectLocal(a, b);
      expect(result).toEqual({ zone: "America/New_York", start: "10:00", end: "11:00" });
    });

    it("returns the contained interval when one interval is fully contained in another", () => {
      const a: LocalInterval = { zone: "America/New_York", start: "09:00", end: "12:00" };
      const b: LocalInterval = { zone: "America/New_York", start: "10:00", end: "11:00" };
      const result = intersectLocal(a, b);
      expect(result).toEqual({ zone: "America/New_York", start: "10:00", end: "11:00" });
    });

    it("returns the matching interval when intervals are identical", () => {
      const a: LocalInterval = { zone: "America/New_York", start: "09:00", end: "10:00" };
      const b: LocalInterval = { zone: "America/New_York", start: "09:00", end: "10:00" };
      const result = intersectLocal(a, b);
      expect(result).toEqual({ zone: "America/New_York", start: "09:00", end: "10:00" });
    });
  });

  describe("subtractLocal", () => {
    it("subtracts a smaller interval from a larger one, returning two pieces", () => {
      const a: LocalInterval = { zone: "America/New_York", start: "09:00", end: "17:00" };
      const b: LocalInterval = { zone: "America/New_York", start: "10:00", end: "11:00" };
      const result = subtractLocal(a, b);
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ zone: "America/New_York", start: "09:00", end: "10:00" });
      expect(result[1]).toEqual({ zone: "America/New_York", start: "11:00", end: "17:00" });
    });

    it("returns one piece when the subtrahend is at the start", () => {
      const a: LocalInterval = { zone: "America/New_York", start: "09:00", end: "17:00" };
      const b: LocalInterval = { zone: "America/New_York", start: "09:00", end: "10:00" };
      const result = subtractLocal(a, b);
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ zone: "America/New_York", start: "10:00", end: "17:00" });
    });

    it("returns one piece when the subtrahend is at the end", () => {
      const a: LocalInterval = { zone: "America/New_York", start: "09:00", end: "17:00" };
      const b: LocalInterval = { zone: "America/New_York", start: "16:00", end: "17:00" };
      const result = subtractLocal(a, b);
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ zone: "America/New_York", start: "09:00", end: "16:00" });
    });

    it("returns empty array when intervals are identical", () => {
      const a: LocalInterval = { zone: "America/New_York", start: "09:00", end: "10:00" };
      const b: LocalInterval = { zone: "America/New_York", start: "09:00", end: "10:00" };
      const result = subtractLocal(a, b);
      expect(result).toHaveLength(0);
    });
  });
});