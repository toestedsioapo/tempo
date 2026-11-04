import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { oracleDecision, oracleSlots } from "./oracle.js";
import type { OracleInput } from "./oracle.js";

const fixturesDir = resolve(import.meta.dirname, "../../fixtures/examples");

interface Fixture {
  id: string;
  input: OracleInput;
  expected: {
    ok: boolean;
    decision?: string;
    reasons?: { code: string; participantId?: string }[];
    slots?: { startUtc: string; endUtc: string }[];
    candidates?: { slot: { startUtc: string; endUtc: string } }[]; // explain entries
  };
}
const load = (n: number): Fixture =>
  JSON.parse(readFileSync(join(fixturesDir, `ex-${String(n).padStart(2, "0")}.json`), "utf8")) as Fixture;

describe("ORC-02: oracle agrees with the SPEC examples (all 24, incl. EX-24 and slots)", () => {
  const all = Array.from({ length: 24 }, (_, i) => load(i + 1));
  // EX-12/13 are DST request-time errors, EX-09/10/23 other errors, EX-22 an explain entry with no top-level decision.
  const checked = all.filter((f) => f.expected.ok && f.expected.decision !== undefined);

  it("covers every example that returns a decision, and the rest are error examples", () => {
    expect(all.filter((f) => !f.expected.ok).map((f) => f.id)).toEqual(["EX-09", "EX-10", "EX-12", "EX-13", "EX-23"]);
    expect(checked.map((f) => f.id)).toContain("EX-24");
    expect(checked).toHaveLength(19);
  });

  it("oracle reports the DST request-time errors of EX-12 and EX-13", () => {
    for (const n of [12, 13]) {
      const r = oracleSlots(load(n).input);
      expect("error" in r).toBe(true);
    }
  });

  it.each(Array.from({ length: 24 }, (_, i) => [`EX-${String(i + 1).padStart(2, "0")}`, i + 1] as const))(
    "%s",
    (_id, n) => {
      const f = load(n);
      if (!f.expected.ok || f.expected.decision === undefined) return;
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
      const r = oracleSlots(f.input);
      if ("error" in r) throw new Error("unexpected oracle error");
      expect({ decision: r.decision, failing: r.failing, gate: r.gate }).toEqual({
        decision: f.expected.decision,
        failing,
        gate,
      });
      if (f.expected.decision === "counter_offer") {
        const iso = (ms: number) => DateTime.fromMillis(ms, { zone: "utc" }).toFormat("yyyy-MM-dd'T'HH:mm:ss'Z'");
        expect(r.slots.map((x) => ({ startUtc: iso(x.startMs), endUtc: iso(x.endMs) }))).toEqual(
          (f.expected.slots ?? f.expected.candidates?.map((c) => c.slot) ?? []).map((x) => ({
            startUtc: x.startUtc,
            endUtc: x.endUtc,
          })),
        );
      }
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

describe("oracle DST rows (G34, A-64)", () => {
  const ny = (weeklyRules: Record<string, { start: string; end: string }[]>) => [
    { partyId: "a", timeZone: "America/New_York", weeklyRules },
  ];
  const utcOpen = { partyId: "z", timeZone: "UTC", weeklyRules: everyDay("00:00", "24:00") };
  const iso = (ms: number) => DateTime.fromMillis(ms, { zone: "utc" }).toFormat("HH:mm");
  // Request `[startUtc, endUtc]` expressed in UTC, to probe exactly where an instance starts and ends.
  const probe = (parts: OracleInput["participants"], date: string, start: string, end: string) =>
    oracleDecision({
      request: { date, start, end, timeZone: "UTC" },
      participants: [...parts, utcOpen],
      options: { now: "2025-01-01T00:00:00Z" },
    }).decision;

  it("NY 2025-03-09 02:30-10:00 is [07:00Z, 14:00Z]", () => {
    const p = ny({ sunday: [{ start: "02:30", end: "10:00" }] });
    expect(probe(p, "2025-03-09", "07:00", "14:00")).toBe("book");
    expect(probe(p, "2025-03-09", "06:59", "14:00")).toBe("counter_offer");
    expect(probe(p, "2025-03-09", "07:00", "14:01")).toBe("counter_offer");
  });

  it("02:30-03:15 is [07:00Z, 07:15Z]", () => {
    const p = ny({ sunday: [{ start: "02:30", end: "03:15" }] });
    expect(probe(p, "2025-03-09", "07:00", "07:15")).toBe("book");
    expect(probe(p, "2025-03-09", "07:00", "07:16")).toBe("counter_offer");
    expect(probe(p, "2025-03-09", "06:59", "07:15")).toBe("counter_offer");
  });

  it("02:30-03:00 (wholly inside the gap) is empty", () => {
    const p = ny({ sunday: [{ start: "02:30", end: "03:00" }] });
    expect(probe(p, "2025-03-09", "07:00", "07:15")).toBe("counter_offer");
    expect(probe(p, "2025-03-09", "06:00", "08:00")).toBe("counter_offer");
  });

  it("overnight 22:00-02:30 ends at 07:00Z", () => {
    const p = ny({ saturday: [{ start: "22:00", end: "02:30" }] });
    // Saturday 22:00 EST = 03:00Z on the 9th; the end 02:30 is in the gap -> 07:00Z.
    expect(probe(p, "2025-03-09", "03:00", "07:00")).toBe("book");
    expect(probe(p, "2025-03-09", "03:00", "07:01")).toBe("counter_offer");
  });

  it("overlap exception: NY 2025-11-02 01:30-05:00 is contiguous from 05:30Z to 10:00Z", () => {
    const p = ny({ sunday: [{ start: "01:30", end: "05:00" }] });
    expect(probe(p, "2025-11-02", "05:30", "10:00")).toBe("book");
    expect(probe(p, "2025-11-02", "05:29", "10:00")).toBe("counter_offer");
    expect(probe(p, "2025-11-02", "05:30", "10:01")).toBe("counter_offer");
    expect(iso(DateTime.utc(2025, 11, 2, 5, 30).toMillis())).toBe("05:30");
  });

  it("request wall times in a gap or overlap are reported as errors", () => {
    const base = { partyId: "a", timeZone: "UTC", weeklyRules: {} };
    const at = (date: string, start: string, end: string) =>
      oracleSlots({ request: { date, start, end, timeZone: "America/New_York" }, participants: [base], options: { now: "2025-01-01T00:00:00Z" } });
    expect(at("2025-03-09", "02:30", "03:30")).toEqual({ error: { code: "DST_NONEXISTENT_LOCAL_TIME", field: "request.start" } });
    expect(at("2025-03-08", "23:30", "02:30")).toEqual({ error: { code: "DST_NONEXISTENT_LOCAL_TIME", field: "request.end" } });
    expect(at("2025-11-02", "01:30", "03:00")).toEqual({ error: { code: "DST_AMBIGUOUS_LOCAL_TIME", field: "request.start" } });
  });
});
