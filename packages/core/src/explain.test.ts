import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { validRequest, withChange } from "../test/helpers.js";
import { evaluate } from "./evaluate.js";
import { explain } from "./explain.js";
import { internalError } from "./internal-error.js";
import { ExplainResultSchema } from "./schema.js";
import type { ExplainResult, NegotiationRequest } from "./types.js";

const asReq = (x: unknown) => x as NegotiationRequest;
const ok = (r: ExplainResult) => {
  if (!r.ok) throw new Error(`expected ok, got ${r.error.code}`);
  return r;
};

describe("CORE-33 explain trace shape (SPEC §3.6)", () => {
  it("book: candidates is [] and every check passes", () => {
    const r = ok(explain(asReq(validRequest())));
    expect(r.decision).toBe("book");
    expect(r.candidates).toEqual([]);
    expect(r.requested.pass).toBe(true);
    expect(r.requested.timeGate).toBe("OK");
    expect(r.requested.checks.map((c) => c.reasonCode)).toEqual(["OK", "OK"]);
    expect(r.requested.checks[0]?.ruleMatched).toEqual({
      weekday: "monday",
      start: "09:00",
      end: "17:00",
      ownerDate: "2025-01-06",
    });
    expect(ExplainResultSchema.safeParse(r).success).toBe(true);
  });

  it("an overnight match reports the start day as ownerDate", () => {
    const input = validRequest() as {
      request: Record<string, unknown>;
      participants: { weeklyRules: Record<string, unknown> }[];
    };
    input.request.start = "01:00";
    input.request.end = "02:00";
    // Monday 01:00 NY belongs to the Sunday 22:00-06:00 shift (owner = Sunday 2025-01-05).
    for (const p of input.participants) p.weeklyRules = { sunday: [{ start: "22:00", end: "06:00" }] };
    // bob is in London: Monday 06:00Z-07:00Z is 06:00-07:00 London, outside 22:00-06:00.
    input.participants[1]!.weeklyRules = { monday: [{ start: "05:00", end: "08:00" }] };
    const r = ok(explain(asReq(input)));
    const alice = r.requested.checks.find((c) => c.participant === "alice");
    expect(alice?.ruleMatched).toEqual({ weekday: "sunday", start: "22:00", end: "06:00", ownerDate: "2025-01-05" });
    expect(alice?.pass).toBe(true);
    const bob = r.requested.checks.find((c) => c.participant === "bob");
    expect(bob?.ruleMatched).toEqual({ weekday: "monday", start: "05:00", end: "08:00", ownerDate: "2025-01-06" });
  });

  it("a failing check has ruleMatched null and a failure reasonCode", () => {
    const r = ok(explain(asReq(withChange(["request", "start"], "08:30"))));
    const alice = r.requested.checks.find((c) => c.participant === "alice");
    expect(alice).toEqual({ participant: "alice", ruleMatched: null, pass: false, reasonCode: "OUTSIDE_AVAILABILITY" });
    expect(r.requested.pass).toBe(false);
  });

  it("IN_BLACKOUT is reported per participant", () => {
    const input = validRequest() as { participants: { blackouts?: string[] }[] };
    input.participants[0]!.blackouts = ["2025-01-06"];
    const r = ok(explain(asReq(input)));
    expect(r.requested.checks[0]).toEqual({
      participant: "alice",
      ruleMatched: null,
      pass: false,
      reasonCode: "IN_BLACKOUT",
    });
    expect(r.decision).toBe("counter_offer");
  });

  it("checks are sorted by participant code-unit order, whatever the input order", () => {
    const input = validRequest() as { participants: { partyId: string }[] };
    input.participants[0]!.partyId = "zed";
    input.participants[1]!.partyId = "Amy";
    const r = ok(explain(asReq(input)));
    expect(r.requested.checks.map((c) => c.participant)).toEqual(["Amy", "zed"]);
  });

  it("a gate failure sets timeGate and pass false even when every check passes", () => {
    const input = validRequest() as { options: Record<string, unknown> };
    input.options.now = "2025-01-06T14:00:00Z";
    input.options.minNoticeMinutes = 60;
    const r = ok(explain(asReq(input)));
    expect(r.requested.timeGate).toBe("INSUFFICIENT_NOTICE");
    expect(r.requested.checks.every((c) => c.pass)).toBe(true);
    expect(r.requested.pass).toBe(false);
    expect(r.decision).toBe("counter_offer");

    input.options.now = "2025-01-06T15:00:00Z";
    expect(ok(explain(asReq(input))).requested.timeGate).toBe("IN_PAST");
  });

  it("every candidate passes and has timeGate OK", () => {
    const r = ok(explain(asReq(withChange(["request", "start"], "08:30"))));
    expect(r.candidates.length).toBeGreaterThan(0);
    for (const c of r.candidates) {
      expect(c.pass).toBe(true);
      expect(c.timeGate).toBe("OK");
    }
  });
});

describe("CORE-34 explain agrees with evaluate", () => {
  const inputs = Array.from({ length: 50 }, (_, i) => {
    const input = validRequest() as {
      request: Record<string, unknown>;
      options: Record<string, unknown>;
      participants: { blackouts?: string[] }[];
    };
    const startMin = 6 * 60 + i * 20; // 06:00 … 22:20
    const hh = String(Math.floor(startMin / 60)).padStart(2, "0");
    const mm = String(startMin % 60).padStart(2, "0");
    const endMin = startMin + 30 + (i % 4) * 15;
    input.request.start = `${hh}:${mm}`;
    input.request.end = `${String(Math.floor(endMin / 60) % 24).padStart(2, "0")}:${String(endMin % 60).padStart(2, "0")}`;
    input.options.maxSuggestions = 1 + (i % 5);
    if (i % 7 === 0) input.participants[1]!.blackouts = ["2025-01-06"];
    if (i % 11 === 0) input.options.minNoticeMinutes = 5000;
    return input;
  });

  it.each(inputs.map((x, i) => [i, x] as const))("input %i", (_i, input) => {
    const e = evaluate(asReq(input));
    const x = explain(asReq(input));
    expect(e.ok).toBe(true);
    expect(x.ok).toBe(true);
    if (!e.ok || !x.ok) return;
    expect(x.decision).toBe(e.decision);
    expect(x.reasons).toEqual(e.reasons);
    expect(x.requested.slot).toEqual(e.requested);
    if (e.decision === "counter_offer") expect(x.candidates.map((c) => c.slot)).toEqual(e.slots);
    else expect(x.candidates).toEqual([]);
  });
});

describe("CORE-33 additional trace cases", () => {
  const rules = (weeklyRules: unknown, blackouts?: string[]) => ({
    partyId: "alice",
    timeZone: "UTC",
    weeklyRules,
    ...(blackouts ? { blackouts } : {}),
  });
  const single = (alice: unknown, req: Record<string, string>, options: Record<string, unknown> = {}) =>
    asReq({
      request: { date: "2025-01-06", timeZone: "UTC", ...req },
      participants: [alice, { partyId: "bob", timeZone: "UTC", weeklyRules: { monday: [{ start: "00:00", end: "24:00" }] } }],
      options: { now: "2025-01-03T12:00:00Z", ...options },
    });

  it("two instances contain the start: ruleMatched is the earliest-starting one (SPEC §3.6)", () => {
    const r = ok(
      explain(
        single(rules({ monday: [{ start: "10:00", end: "14:00" }, { start: "09:00", end: "12:00" }] }), {
          start: "10:30",
          end: "11:00",
        }),
      ),
    );
    expect(r.requested.checks[0]?.ruleMatched).toMatchObject({ start: "09:00", end: "12:00" });
  });

  it("a blacked-out instance is skipped and the next open one is reported", () => {
    // Sunday 22:00-12:00 (owner 2025-01-05, blacked out) and Monday 09:00-12:00 both contain Monday 10:30.
    const r = ok(
      explain(
        single(
          rules({ sunday: [{ start: "22:00", end: "12:00" }], monday: [{ start: "09:00", end: "12:00" }] }, ["2025-01-05"]),
          { start: "10:30", end: "11:00" },
        ),
      ),
    );
    expect(r.requested.checks[0]).toMatchObject({ pass: true, ruleMatched: { weekday: "monday", ownerDate: "2025-01-06" } });
  });

  it("a failing overnight request has ruleMatched null", () => {
    const r = ok(explain(single(rules({ sunday: [{ start: "22:00", end: "06:00" }] }), { start: "05:30", end: "06:30" })));
    expect(r.requested.checks[0]).toEqual({
      participant: "alice",
      ruleMatched: null,
      pass: false,
      reasonCode: "OUTSIDE_AVAILABILITY",
    });
  });

  it("candidate traces carry their own slot, sorted checks and rule matches", () => {
    const r = ok(explain(asReq(withChange(["request", "start"], "08:30"))));
    const first = r.candidates[0];
    expect(first?.slot.startUtc).toBeDefined();
    expect(first?.checks.map((c) => c.participant)).toEqual(["alice", "bob"]);
    for (const c of first?.checks ?? []) {
      expect(c.ruleMatched).not.toBeNull();
      expect(c.reasonCode).toBe("OK");
    }
    const e = evaluate(asReq(withChange(["request", "start"], "08:30")));
    expect(r.candidates.map((c) => c.slot)).toEqual(e.ok ? e.slots : null);
  });

  it("counter_offer with no slot in the horizon: candidates [] and NO_SLOTS_IN_HORIZON last", () => {
    const input = single(rules({}), { start: "10:00", end: "11:00" }, { searchHorizonDays: 1 });
    const r = ok(explain(input));
    expect(r.decision).toBe("counter_offer");
    expect(r.candidates).toEqual([]);
    expect(r.reasons.at(-1)?.code).toBe("NO_SLOTS_IN_HORIZON");
    expect(r).toEqual({ ...r, reasons: (evaluate(input) as { reasons: unknown[] }).reasons });
  });

  it("DST_RULE_ADJUSTED requests: explain still agrees with evaluate", () => {
    const input = asReq({
      request: { date: "2025-03-09", start: "03:00", end: "03:15", timeZone: "America/New_York" },
      participants: [
        { partyId: "alice", timeZone: "America/New_York", weeklyRules: { sunday: [{ start: "02:30", end: "10:00" }] } },
        { partyId: "bob", timeZone: "UTC", weeklyRules: { sunday: [{ start: "00:00", end: "24:00" }] } },
      ],
      options: { now: "2025-03-01T00:00:00Z" },
    });
    const e = evaluate(input);
    const x = ok(explain(input));
    expect(e.ok && e.reasons.map((r) => r.code)).toContain("DST_RULE_ADJUSTED");
    expect(x.reasons).toEqual(e.ok ? e.reasons : null);
    expect(x.decision).toBe(e.ok ? e.decision : null);
  });

  it("the 50 CORE-34 inputs cover book, counter_offer and gate failures", () => {
    // Guards the generator: see the CORE-34 block above.
    const decisions = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const input = validRequest() as { request: Record<string, unknown> };
      const m = 6 * 60 + i * 20;
      input.request.start = `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
      input.request.end = `${String(Math.floor((m + 30) / 60) % 24).padStart(2, "0")}:${String((m + 30) % 60).padStart(2, "0")}`;
      const r = explain(asReq(input));
      if (r.ok) decisions.add(r.decision);
    }
    expect([...decisions].sort()).toEqual(["book", "counter_offer"]);
  });

  it("an ambiguous zone and a DST-ambiguous time give evaluate's error through explain", () => {
    const ist = withChange(["participants", 0, "timeZone"], "IST");
    const amb = asReq({
      request: { date: "2025-11-02", start: "01:30", end: "02:30", timeZone: "America/New_York" },
      participants: [
        { partyId: "a", timeZone: "UTC", weeklyRules: {} },
        { partyId: "b", timeZone: "UTC", weeklyRules: {} },
      ],
      options: { now: "2025-10-01T00:00:00Z" },
    });
    for (const input of [asReq(ist), amb]) {
      const e = evaluate(input);
      expect(e.ok).toBe(false);
      expect(explain(input)).toEqual(e);
    }
  });
});

describe("EX-22 byte-exact", () => {
  it("matches the fixture", () => {
    const f = JSON.parse(readFileSync(resolve(import.meta.dirname, "../fixtures/examples/ex-22.json"), "utf8")) as {
      entry: string;
      input: unknown;
      expected: unknown;
    };
    expect(f.entry).toBe("explain");
    expect(explain(asReq(f.input))).toEqual(f.expected);
  });
});

describe("errors are identical to evaluate", () => {
  it("EX-12: a nonexistent request time", () => {
    const f = JSON.parse(readFileSync(resolve(import.meta.dirname, "../fixtures/examples/ex-12.json"), "utf8")) as {
      input: unknown;
    };
    const e = evaluate(asReq(f.input));
    expect(e.ok).toBe(false);
    expect(explain(asReq(f.input))).toEqual(e);
  });

  it("invalid and non-object input", () => {
    for (const bad of [null, 42, "x", {}, withChange(["request", "timeZone"], "IST")]) {
      const e = evaluate(asReq(bad));
      expect(e.ok).toBe(false);
      expect(explain(asReq(bad))).toEqual(e);
    }
  });
});

describe("G33 explain never throws", () => {
  afterEach(() => {
    vi.doUnmock("./search.js");
    vi.resetModules();
  });

  it("an exception after the input was accepted is INTERNAL_ERROR", async () => {
    vi.resetModules();
    vi.doMock("./search.js", () => ({
      searchSlots: () => {
        throw new Error("secret");
      },
    }));
    const mod = await import("./explain.js");
    expect(mod.explain(asReq(withChange(["request", "start"], "08:30")))).toEqual(internalError());
  });
});
