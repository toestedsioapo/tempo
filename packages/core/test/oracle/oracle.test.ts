import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { oracleDecision } from "./oracle.js";
import type { OracleInput } from "./oracle.js";

const fixturesDir = resolve(import.meta.dirname, "../../fixtures/examples");

// Five error examples (expected.ok === false) plus EX-24 (A-55).
const EXCLUDED_IDS = ["EX-09", "EX-10", "EX-12", "EX-13", "EX-23", "EX-24"] as const;

interface Fixture {
  id: string;
  input: OracleInput;
  expected: { ok: boolean; decision?: string; reasons?: { code: string; participantId?: string }[] };
}
const load = (n: number): Fixture =>
  JSON.parse(readFileSync(join(fixturesDir, `ex-${String(n).padStart(2, "0")}.json`), "utf8")) as Fixture;

describe("ORC-02: oracle agrees with the SPEC examples", () => {
  const all = Array.from({ length: 24 }, (_, i) => load(i + 1));
  const checked = all.filter((f) => f.expected.ok && !EXCLUDED_IDS.includes(f.id as never));

  it("checks exactly 18 examples", () => {
    expect(checked).toHaveLength(18);
    for (const id of EXCLUDED_IDS.slice(0, 5)) {
      expect(all.find((f) => f.id === id)?.expected.ok).toBe(false);
    }
  });

  it.each(Array.from({ length: 24 }, (_, i) => i + 1).filter((n) => !EXCLUDED_IDS.includes(`EX-${String(n).padStart(2, "0")}` as never)).map((n) => [`EX-${String(n).padStart(2, "0")}`, n] as const))(
    "%s",
    (_id, n) => {
      const f = load(n);
      const reasons = f.expected.reasons ?? [];
      const failing = reasons
        .filter((r) => r.code === "OUTSIDE_AVAILABILITY" || r.code === "IN_BLACKOUT")
        .map((r) => r.participantId as string)
        .sort();
      const gate = reasons.some((r) => r.code === "IN_PAST")
        ? "IN_PAST"
        : reasons.some((r) => r.code === "INSUFFICIENT_NOTICE")
          ? "INSUFFICIENT_NOTICE"
          : "OK";
      expect(oracleDecision(f.input)).toEqual({ decision: f.expected.decision, failing, gate });
    },
  );
});

const everyDay = (start: string, end: string) =>
  Object.fromEntries(
    ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].map((d) => [d, [{ start, end }]]),
  );
const base = (over: Partial<OracleInput["request"]>, parts: OracleInput["participants"], extra = {}): OracleInput => ({
  request: { date: "2025-01-13", start: "10:00", end: "11:00", timeZone: "UTC", ...over },
  participants: parts,
  options: { now: "2025-01-01T00:00:00Z", ...extra },
});

describe("oracle direct cases", () => {
  it("overnight rule covers the early hours of the next day", () => {
    const inp = base({ date: "2025-01-14", start: "01:00", end: "02:00" }, [
      { partyId: "a", timeZone: "UTC", weeklyRules: { monday: [{ start: "22:00", end: "06:00" }] } },
    ]);
    expect(oracleDecision(inp).decision).toBe("book");
    // Tuesday 01:00 is not covered by a Tuesday rule alone.
    const inp2 = base({ date: "2025-01-14", start: "01:00", end: "02:00" }, [
      { partyId: "a", timeZone: "UTC", weeklyRules: { tuesday: [{ start: "22:00", end: "06:00" }] } },
    ]);
    expect(oracleDecision(inp2)).toMatchObject({ decision: "counter_offer", failing: ["a"] });
  });

  it("blackout removes the instance owned by that date, including after midnight", () => {
    const parts = (bl: string) => [
      { partyId: "a", timeZone: "UTC", weeklyRules: { monday: [{ start: "22:00", end: "06:00" }] }, blackouts: [bl] },
    ];
    const req = { date: "2025-01-14", start: "01:00", end: "02:00" };
    expect(oracleDecision(base(req, parts("2025-01-13"))).decision).toBe("counter_offer");
    expect(oracleDecision(base(req, parts("2025-01-14"))).decision).toBe("book");
  });

  it("24:00 end and touching intervals: request ending exactly at the end books", () => {
    const one = [{ partyId: "a", timeZone: "UTC", weeklyRules: { monday: [{ start: "09:00", end: "24:00" }] } }];
    expect(oracleDecision(base({ start: "23:00", end: "00:00" }, one)).decision).toBe("book");
    const two = [
      {
        partyId: "a",
        timeZone: "UTC",
        weeklyRules: { monday: [{ start: "09:00", end: "12:00" }, { start: "12:00", end: "17:00" }] },
      },
    ];
    expect(oracleDecision(base({ start: "11:00", end: "13:00" }, two)).decision).toBe("book");
    expect(oracleDecision(base({ start: "16:00", end: "17:00" }, two)).decision).toBe("book");
    expect(oracleDecision(base({ start: "16:30", end: "17:30" }, two)).decision).toBe("counter_offer");
  });

  it("gap between rules fails and zones are converted", () => {
    const parts = [
      { partyId: "a", timeZone: "UTC", weeklyRules: everyDay("00:00", "24:00") },
      { partyId: "b", timeZone: "Asia/Manila", weeklyRules: { monday: [{ start: "09:00", end: "10:00" }] } },
    ];
    // 10:00 UTC = 18:00 Manila Monday: outside b's 09-10.
    expect(oracleDecision(base({}, parts))).toEqual({ decision: "counter_offer", failing: ["b"], gate: "OK" });
    // 01:00-02:00 UTC = 09:00-10:00 Manila: fits.
    expect(oracleDecision(base({ start: "01:00", end: "02:00" }, parts)).decision).toBe("book");
  });

  it("gates: past, notice, and equality passes", () => {
    const p = [{ partyId: "a", timeZone: "UTC", weeklyRules: everyDay("00:00", "24:00") }];
    const at = (now: string, n?: number) =>
      oracleDecision(base({}, p, { now, ...(n === undefined ? {} : { minNoticeMinutes: n }) })).gate;
    expect(at("2025-01-13T10:00:01Z")).toBe("IN_PAST");
    expect(at("2025-01-13T10:00:00Z")).toBe("OK");
    expect(at("2025-01-13T08:00:00Z", 120)).toBe("OK");
    expect(at("2025-01-13T08:00:01Z", 120)).toBe("INSUFFICIENT_NOTICE");
  });

  it("request end <= start rolls to the next date", () => {
    const p = [{ partyId: "a", timeZone: "UTC", weeklyRules: { monday: [{ start: "22:00", end: "24:00" }], tuesday: [{ start: "00:00", end: "01:00" }] } }];
    expect(oracleDecision(base({ date: "2025-01-13", start: "23:00", end: "00:30" }, p)).decision).toBe("book");
    expect(oracleDecision(base({ date: "2025-01-13", start: "23:00", end: "01:30" }, p)).decision).toBe("counter_offer");
  });
});
