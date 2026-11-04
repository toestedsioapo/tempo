// INV-01 … INV-14 (TEST_PLAN §4), checked against the independent oracle's availability
// (test/oracle/oracle.ts), never the engine's own helpers. Failing seeds are pinned in the
// "regressions" block at the bottom.
import fc from "fast-check";
import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import { evaluate, explain, suggest } from "../src/index.js";
import type { NegotiationRequest, NegotiationResult } from "../src/index.js";
import { blackoutDatesFor, GEN_ZONES, hhmm, negotiationInputArb } from "./generators.js";
import type { DifferentialInput } from "./generators.js";
import { oracleCovers, oracleInstant, oracleSlots } from "./oracle/oracle.js";
import { propRuns, propTimeoutMs } from "./runs.js";

const TIMEOUT_MS = propTimeoutMs();
const MIN_MS = 60_000;
const asReq = (x: unknown) => x as NegotiationRequest;
const run = <T>(name: string, arb: fc.Arbitrary<T>, check: (i: T) => void) =>
  it(name, () => fc.assert(fc.property(arb, check), { numRuns: propRuns() }), TIMEOUT_MS);
const okOnly = (r: NegotiationResult) => (r.ok ? r : null);
const ms = (utc: string): number => DateTime.fromISO(utc, { zone: "utc" }).toMillis();
const span = (s: { startUtc: string; endUtc: string }) => ({ startMs: ms(s.startUtc), endMs: ms(s.endUtc) });

/** Inputs whose request wall times are valid (no C10 error), so results carry slots. */
const arb = negotiationInputArb().filter((i) => !("error" in oracleSlots(i)));

describe("INV-01 … INV-05: slots and decisions", () => {
  run("INV-01 book => the requested range is inside every participant's availability", arb, (i) => {
    const r = okOnly(evaluate(asReq(i)));
    if (r?.decision !== "book") return;
    expect(oracleCovers(i, [span(r.requested)])).toEqual([true]);
  });

  run("INV-02 every slot has start < end and the request's duration", arb, (i) => {
    for (const fn of [evaluate, suggest]) {
      const r = okOnly(fn(asReq(i)));
      if (!r) continue;
      const d = span(r.requested).endMs - span(r.requested).startMs;
      for (const s of r.slots) {
        expect(span(s).startMs).toBeLessThan(span(s).endMs);
        expect(span(s).endMs - span(s).startMs).toBe(d);
      }
    }
  });

  run("INV-03 re-submitting a slot (timeZone UTC) books the same instants", arb, (i) => {
    const r = okOnly(suggest(asReq(i)));
    if (!r) return;
    for (const s of r.slots) {
      // A-67: a wall-clock request spans under 24 h in UTC wording; longer real durations (a request
      // across a fall-back, e.g. NY 00:31 -> 00:20 next day = 24 h 49 min) cannot be restated.
      if (span(s).endMs - span(s).startMs >= 86_400_000) continue;
      const again = evaluate(
        asReq({
          ...i,
          request: {
            date: s.startUtc.slice(0, 10),
            start: s.startUtc.slice(11, 16),
            end: s.endUtc.slice(11, 16),
            timeZone: "UTC",
          },
        }),
      );
      expect(again.ok && again.decision).toBe("book");
      expect(again.ok && [again.requested.startUtc, again.requested.endUtc]).toEqual([s.startUtc, s.endUtc]);
    }
  });

  run("INV-04 slots are inside availability and at or after now + minNotice", arb, (i) => {
    const r = okOnly(suggest(asReq(i)));
    if (!r) return;
    const bound = ms(i.options.now) + (i.options.minNoticeMinutes ?? 0) * MIN_MS;
    const spans = r.slots.map(span);
    expect(oracleCovers(i, spans).every(Boolean)).toBe(true);
    for (const s of spans) expect(s.startMs).toBeGreaterThanOrEqual(bound);
  });

  run("INV-05 rank order, unique, at most maxSuggestions", arb, (i) => {
    const r = okOnly(suggest(asReq(i)));
    if (!r) return;
    const rs = span(r.requested).startMs;
    const keys = r.slots.map((s) => [Math.abs(span(s).startMs - rs), span(s).startMs] as const);
    for (let k = 1; k < keys.length; k++) {
      const [a, b] = [keys[k - 1], keys[k]] as [readonly [number, number], readonly [number, number]];
      expect(a[0] < b[0] || (a[0] === b[0] && a[1] < b[1])).toBe(true);
    }
    expect(new Set(r.slots.map((s) => s.startUtc)).size).toBe(r.slots.length);
    expect(r.slots.length).toBeLessThanOrEqual(i.options.maxSuggestions ?? 3);
  });
});

describe("INV-06 … INV-09: determinism, symmetry, monotonicity, round trip", () => {
  run("INV-06 two runs give byte-identical JSON", negotiationInputArb(), (i) => {
    for (const fn of [evaluate, suggest, explain]) {
      expect(JSON.stringify(fn(asReq(i)))).toBe(JSON.stringify(fn(asReq(i))));
    }
  });

  run("INV-07 participant order does not matter", negotiationInputArb(), (i) => {
    const rotated = { ...i, participants: [...i.participants.slice(1), ...i.participants.slice(0, 1)] };
    const reversed = { ...i, participants: [...i.participants].reverse() };
    for (const fn of [evaluate, suggest, explain]) {
      const base = JSON.stringify(fn(asReq(i)));
      expect(JSON.stringify(fn(asReq(rotated)))).toBe(base);
      expect(JSON.stringify(fn(asReq(reversed)))).toBe(base);
    }
  });

  run(
    "INV-08 adding a blackout never turns counter_offer into book and never adds a fitting candidate",
    fc.tuple(arb, fc.nat(), fc.nat()).map(([i, p, d]) => {
      const idx = p % i.participants.length;
      const dates = blackoutDatesFor(i, idx);
      const date = dates[d % dates.length] as string;
      const party = i.participants[idx] as DifferentialInput["participants"][number];
      const participants = i.participants.map((x) => (x === party ? { ...x, blackouts: [...(x.blackouts ?? []), date] } : x));
      return { before: i, after: { ...i, participants } };
    }),
    ({ before, after }) => {
      const b = okOnly(evaluate(asReq(before)));
      const a = okOnly(evaluate(asReq(after)));
      if (b?.decision === "counter_offer") expect(a?.decision).toBe("counter_offer");
      const slotsAfter = okOnly(suggest(asReq(after)))?.slots.map(span) ?? [];
      expect(oracleCovers(before, slotsAfter).every(Boolean)).toBe(true);
    },
  );

  run("INV-09 formatting startUtc in the requester zone round-trips to the same instant", arb, (i) => {
    const r = okOnly(suggest(asReq(i)));
    if (!r) return;
    for (const s of [r.requested, ...r.slots]) {
      for (const [utc, local] of [
        [s.startUtc, s.start],
        [s.endUtc, s.end],
      ] as const) {
        const formatted = DateTime.fromISO(utc, { zone: i.request.timeZone }).toISO({ suppressMilliseconds: true });
        expect(DateTime.fromISO(formatted as string).toMillis()).toBe(ms(utc));
        expect(DateTime.fromISO(local).toMillis()).toBe(ms(utc));
      }
    }
  });
});

describe("INV-10 never throws", () => {
  const codes = new Set(["INVALID_INPUT", "AMBIGUOUS_ZONE", "INVALID_ZONE", "INVALID_INTERVAL", "DST_NONEXISTENT_LOCAL_TIME", "DST_AMBIGUOUS_LOCAL_TIME"]);

  const mutate = (base: unknown, junk: unknown, path: number[]): unknown => {
    const clone = JSON.parse(JSON.stringify(base)) as Record<string, unknown>;
    const keys = ["request", "participants", "options"];
    const key = keys[(path[0] as number) % keys.length] as string;
    clone[key] = junk;
    return clone;
  };

  it("arbitrary JSON values and mutated valid requests give ok or a closed-enum error, never INTERNAL_ERROR", () => {
    const valid = fc.sample(negotiationInputArb(), { numRuns: 20, seed: 11 });
    fc.assert(
      fc.property(
        fc.oneof(
          fc.anything(),
          fc.jsonValue(),
          fc.tuple(fc.constantFrom(...valid), fc.anything(), fc.array(fc.nat(), { minLength: 1, maxLength: 1 })).map(([b, j, p]) => mutate(b, j, p)),
          fc.constant(null),
          fc.constant({ request: {}, participants: [], options: {} }),
          fc.string({ minLength: 0, maxLength: 5000 }),
          fc.constant(1e308),
        ),
        (value) => {
          for (const fn of [evaluate, suggest, explain]) {
            const r = fn(asReq(value));
            if (r.ok) continue;
            expect(r.error.code).not.toBe("INTERNAL_ERROR");
            expect(codes.has(r.error.code)).toBe(true);
          }
        },
      ),
      { numRuns: propRuns() },
    );
  }, TIMEOUT_MS);

  it("deeply nested input returns INVALID_INPUT", () => {
    let deep: unknown = {};
    for (let n = 0; n < 5000; n++) deep = { a: deep };
    const r = evaluate(asReq(deep));
    expect(!r.ok && r.error.code).toBe("INVALID_INPUT");
  });
});

describe("INV-11 … INV-14", () => {
  run("INV-11 restating the same instants in another zone gives the same decision and UTC slots", arb, (i) => {
    const base = okOnly(suggest(asReq(i)));
    if (!base) return;
    const startMs = ms(base.requested.startUtc);
    const endMs = ms(base.requested.endUtc);
    // A-67: a wall-clock request (date, start, end; end <= start means next day) can only express
    // some instant pairs in a given zone. Restate only when it round-trips to the same instants:
    // e.g. NY 00:57 -> 00:51 next day across a fall-back lasts 24 h 54 min and has no UTC wording.
    for (const zone of ["UTC", ...GEN_ZONES]) {
      const s = DateTime.fromMillis(startMs, { zone });
      const e = DateTime.fromMillis(endMs, { zone });
      const startWall = hhmm(s.hour * 60 + s.minute);
      const endWall = hhmm(e.hour * 60 + e.minute);
      const date = s.toISODate() as string;
      const endDate = endWall <= startWall ? (s.plus({ days: 1 }).toISODate() as string) : date;
      if (oracleInstant(zone, date, startWall) !== startMs) continue;
      if (oracleInstant(zone, endDate, endWall) !== endMs) continue;
      const other = { ...i, request: { date, start: startWall, end: endWall, timeZone: zone } };
      const r = okOnly(suggest(asReq(other)));
      expect(r?.decision).toBe(base.decision);
      expect(r?.slots.map((x) => [x.startUtc, x.endUtc])).toEqual(base.slots.map((x) => [x.startUtc, x.endUtc]));
    }
  });

  it("INV-12 overnight instances: owned by the start day, real length = nominal wrap + DST delta", () => {
    const cases: [string, string, string, string][] = [
      // zone, owner date, start, end
      ["America/New_York", "2025-03-08", "22:00", "06:00"], // spring forward during the shift
      ["America/New_York", "2025-11-01", "22:00", "06:00"], // fall back during the shift
      ["Europe/Berlin", "2025-03-29", "20:00", "04:00"],
      ["Australia/Sydney", "2025-04-05", "21:00", "07:00"],
      ["Australia/Lord_Howe", "2025-10-04", "22:00", "05:00"],
      ["Asia/Manila", "2025-03-08", "22:00", "06:00"], // no DST
      ["America/New_York", "2025-06-10", "23:00", "07:00"], // no transition
    ];
    const day = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
    for (const [zone, date, start, end] of cases) {
      const d = DateTime.fromISO(date, { zone: "utc" });
      const next = d.plus({ days: 1 }).toISODate() as string;
      const s = oracleInstant(zone, date, start) as number;
      const e = oracleInstant(zone, next, end) as number;
      const nominalMin = ((Number(end.slice(0, 2)) * 60 + Number(end.slice(3))) + 1440) - (Number(start.slice(0, 2)) * 60 + Number(start.slice(3)));
      const offStart = DateTime.fromMillis(s, { zone }).offset;
      const offEnd = DateTime.fromMillis(e, { zone }).offset;
      expect((e - s) / MIN_MS).toBe(nominalMin + (offStart - offEnd));
      const input = (a: number, b: number, owner: string) =>
        asReq({
          request: {
            date: DateTime.fromMillis(a, { zone: "utc" }).toISODate(),
            start: DateTime.fromMillis(a, { zone: "utc" }).toFormat("HH:mm"),
            end: DateTime.fromMillis(b, { zone: "utc" }).toFormat("HH:mm"),
            timeZone: "UTC",
          },
          participants: [
            { partyId: "a", timeZone: zone, weeklyRules: { [day[d.weekday % 7] as string]: [{ start, end }] }, blackouts: owner ? [owner] : [] },
            { partyId: "z", timeZone: "UTC", weeklyRules: Object.fromEntries(day.map((x) => [x, [{ start: "00:00", end: "24:00" }]])) },
          ],
          options: { now: "2020-01-01T00:00:00Z" },
        });
      const whole = evaluate(input(s, e, ""));
      expect(whole.ok && whole.decision).toBe("book");
      expect(evaluate(input(s, e + MIN_MS, "")).ok && (evaluate(input(s, e + MIN_MS, "")) as { decision: string }).decision).toBe("counter_offer");
      // Ownership: blacking out the START day removes the instance; the end day does not.
      expect((evaluate(input(s, e, date)) as { decision: string }).decision).toBe("counter_offer");
      expect((evaluate(input(s, e, next)) as { decision: string }).decision).toBe("book");
    }
  });

  run(
    "INV-13 adding an availability rule never turns book into counter_offer",
    fc
      .tuple(arb, fc.nat(), fc.nat(), fc.integer({ min: 0, max: 1438 }), fc.integer({ min: 1, max: 1439 }))
      .map(([i, p, dayIdx, s, len]) => {
        const days = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;
        const idx = p % i.participants.length;
        const day = days[dayIdx % 7] as (typeof days)[number];
        const extra = { start: hhmm(s), end: hhmm(Math.min(1439, s + len)) };
        const participants = i.participants.map((x, k) =>
          k === idx ? { ...x, weeklyRules: { ...x.weeklyRules, [day]: [...(x.weeklyRules[day] ?? []), extra] } } : x,
        );
        return { before: i, after: { ...i, participants } };
      }),
    ({ before, after }) => {
      const b = okOnly(evaluate(asReq(before)));
      if (b?.decision !== "book") return;
      expect(okOnly(evaluate(asReq(after)))?.decision).toBe("book");
    },
  );

  run("INV-14 no overlap, and the greedy pick is maximal", arb, (i) => {
    const r = okOnly(suggest(asReq(i)));
    if (!r) return;
    const slots = r.slots.map(span);
    for (let a = 0; a < slots.length; a++) {
      for (let b = a + 1; b < slots.length; b++) {
        const [x, y] = [slots[a], slots[b]] as [ReturnType<typeof span>, ReturnType<typeof span>];
        expect(x.startMs >= y.endMs || y.startMs >= x.endMs).toBe(true);
      }
    }
    // Rebuild the fitting lattice with the oracle's availability and replay the greedy rule.
    const rs = span(r.requested).startMs;
    const dur = span(r.requested).endMs - rs;
    const step = (i.options.searchStepMinutes ?? 15) * MIN_MS;
    const kMax = Math.floor(((i.options.searchHorizonDays ?? 14) * 86_400_000) / step);
    const bound = ms(i.options.now) + (i.options.minNoticeMinutes ?? 0) * MIN_MS;
    const lattice: { startMs: number; endMs: number }[] = [];
    for (let k = -kMax; k <= kMax; k++) {
      const s = rs + k * step;
      if (s >= bound) lattice.push({ startMs: s, endMs: s + dur });
    }
    const covered = oracleCovers(i, lattice);
    const fitting = lattice
      .filter((_, k) => covered[k])
      .sort((p, q) => Math.abs(p.startMs - rs) - Math.abs(q.startMs - rs) || p.startMs - q.startMs);
    const returned = new Set(slots.map((s) => s.startMs));
    const picked: typeof slots = [];
    for (const c of fitting) {
      const overlapsPicked = picked.some((p) => c.startMs < p.endMs && p.startMs < c.endMs);
      if (picked.length >= (i.options.maxSuggestions ?? 3)) {
        // Once the cap is hit, nothing further is returned.
        expect(returned.has(c.startMs) && !picked.some((p) => p.startMs === c.startMs)).toBe(false);
        continue;
      }
      if (!overlapsPicked) {
        // Maximality: a fitting candidate that overlaps nothing returned earlier must be returned.
        expect(returned.has(c.startMs)).toBe(true);
        picked.push(c);
      } else {
        expect(returned.has(c.startMs)).toBe(false);
      }
    }
    expect(picked.map((s) => s.startMs)).toEqual(slots.map((s) => s.startMs));
  });
});

describe("regressions (pinned failing seeds)", () => {
  it("INV-03/INV-11 (A-67): a request across a fall-back can last 24 h 49 min and has no UTC wording", () => {
    // Seed -551987296 at 5,000 runs: NY 2024-11-03 00:31 -> 00:20 next day.
    const input = asReq({
      request: { date: "2024-11-03", start: "00:31", end: "00:20", timeZone: "America/New_York" },
      participants: [{ partyId: "a", timeZone: "UTC", weeklyRules: Object.fromEntries(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].map((d) => [d, [{ start: "00:00", end: "24:00" }]])) }, { partyId: "b", timeZone: "UTC", weeklyRules: Object.fromEntries(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].map((d) => [d, [{ start: "00:00", end: "24:00" }]])) }],
      options: { now: "2024-01-01T00:00:00Z" },
    });
    const r = suggest(input);
    expect(r.ok && r.requested.startUtc).toBe("2024-11-03T04:31:00Z");
    expect(r.ok && r.requested.endUtc).toBe("2024-11-04T05:20:00Z");
    // The naive UTC restatement (04:31 -> 05:20) is a 49-minute request on the same day, a different request.
    const naive = evaluate(asReq({ ...(input as object), request: { date: "2024-11-03", start: "04:31", end: "05:20", timeZone: "UTC" } }));
    expect(naive.ok && naive.requested.endUtc).toBe("2024-11-03T05:20:00Z");
  });
});
