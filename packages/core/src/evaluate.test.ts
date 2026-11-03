import { describe, expect, it } from "vitest";
import { validRequest, withChange } from "../test/helpers.js";
import { evaluate } from "./evaluate.js";
import type { NegotiationRequest } from "./types.js";

const run = (input: unknown) => evaluate(input as NegotiationRequest);

type Rules = Record<string, { start: string; end: string }[]>;
function scenario(opts: {
  date?: string;
  start: string;
  end: string;
  zone?: string;
  now?: string;
  minNotice?: number;
  parties: { id: string; zone: string; rules: Rules; blackouts?: string[] }[];
}): NegotiationRequest {
  return {
    request: {
      date: opts.date ?? "2025-01-06",
      start: opts.start,
      end: opts.end,
      timeZone: opts.zone ?? "UTC",
    },
    participants: opts.parties.map((p) => ({
      partyId: p.id,
      timeZone: p.zone,
      weeklyRules: p.rules,
      ...(p.blackouts ? { blackouts: p.blackouts } : {}),
    })),
    options: { now: opts.now ?? "2025-01-03T00:00:00Z", minNoticeMinutes: opts.minNotice ?? 0 },
  } as unknown as NegotiationRequest;
}
const codes = (r: ReturnType<typeof evaluate>) =>
  r.ok ? r.reasons.map((x) => `${x.code}:${x.participantId ?? ""}`) : [];
const day = (s: string, e: string) => ({ start: s, end: e });
const utc = (id: string, rules: Rules, blackouts?: string[]) => ({
  id,
  zone: "UTC",
  rules,
  ...(blackouts ? { blackouts } : {}),
});

describe("SPEC examples", () => {
  it("EX-01 books", () => {
    expect(run(validRequest())).toEqual({
      ok: true,
      decision: "book",
      requested: {
        start: "2025-01-06T09:30:00-05:00",
        end: "2025-01-06T10:30:00-05:00",
        startUtc: "2025-01-06T14:30:00Z",
        endUtc: "2025-01-06T15:30:00Z",
      },
      slots: [
        {
          start: "2025-01-06T09:30:00-05:00",
          end: "2025-01-06T10:30:00-05:00",
          startUtc: "2025-01-06T14:30:00Z",
          endUtc: "2025-01-06T15:30:00Z",
        },
      ],
      reasons: [],
    });
  });

  it("EX-09 rule with start == end", () => {
    const input = scenario({
      start: "09:00",
      end: "10:00",
      parties: [utc("alice", { monday: [day("09:00", "17:00")] }), utc("bob", { monday: [day("09:00", "09:00")] })],
    });
    expect(run(input)).toEqual({
      ok: false,
      error: {
        code: "INVALID_INTERVAL",
        message: "Availability interval start and end must differ.",
        details: { field: "participants[1].weeklyRules.monday[0]", start: "09:00", end: "09:00" },
      },
    });
  });

  it("EX-10 request with start == end", () => {
    const input = withChange(["request"], {
      date: "2025-01-06",
      start: "09:00",
      end: "09:00",
      timeZone: "Europe/London",
    });
    expect(run(input)).toEqual({
      ok: false,
      error: {
        code: "INVALID_INPUT",
        message: "Request start and end must differ.",
        details: { issues: [{ path: "request.end", message: "Request start and end must differ." }] },
      },
    });
  });

  it("EX-23 ambiguous IST", () => {
    expect(run(withChange(["participants", 1, "timeZone"], "IST"))).toEqual({
      ok: false,
      error: {
        code: "AMBIGUOUS_ZONE",
        message: 'Time zone abbreviation "IST" is ambiguous; use an IANA zone.',
        details: {
          field: "participants[1].timeZone",
          value: "IST",
          options: ["Asia/Kolkata", "Europe/Dublin", "Asia/Jerusalem"],
        },
      },
    });
  });
});

describe("CORE-11 error precedence", () => {
  it("zone error beats an invalid interval in an earlier participant", () => {
    const input = withChange(["participants", 1, "timeZone"], "IST") as {
      participants: { weeklyRules: Rules }[];
    };
    input.participants[0]!.weeklyRules = { monday: [day("09:00", "09:00")] };
    const r = run(input);
    expect(r.ok === false && r.error.code).toBe("AMBIGUOUS_ZONE");
  });
  it("schema error beats both", () => {
    const input = withChange(["participants", 1, "timeZone"], "IST") as {
      participants: { weeklyRules: Rules }[];
      request: { date: string };
    };
    input.participants[0]!.weeklyRules = { monday: [day("09:00", "09:00")] };
    input.request.date = "nope";
    const r = run(input);
    expect(r.ok === false && r.error.code).toBe("INVALID_INPUT");
  });
});

describe("CORE-12 cross-zone owning date", () => {
  const parties = (bob: Rules) => [
    { id: "alice", zone: "America/New_York", rules: { monday: [day("19:00", "22:00")] } },
    { id: "bob", zone: "Asia/Manila", rules: bob },
  ];
  it("books via bob's tuesday morning", () => {
    const r = run(
      scenario({ start: "20:00", end: "21:00", zone: "America/New_York", parties: parties({ tuesday: [day("08:00", "11:00")] }) }),
    );
    expect(r.ok && r.decision).toBe("book");
  });
  it("counter-offers with a monday-only bob", () => {
    const r = run(
      scenario({ start: "20:00", end: "21:00", zone: "America/New_York", parties: parties({ monday: [day("08:00", "11:00")] }) }),
    );
    expect(r.ok && r.decision).toBe("counter_offer");
    expect(codes(r)).toEqual(["OUTSIDE_AVAILABILITY:bob"]);
  });
});

describe("CORE-13..15 containment", () => {
  const split = (rules: Rules) => [utc("alice", rules), utc("bob", { monday: [day("00:00", "24:00")] })];
  it("CORE-13 gap in a split shift", () => {
    const r = run(
      scenario({ start: "12:00", end: "13:00", parties: split({ monday: [day("09:00", "12:00"), day("13:00", "17:00")] }) }),
    );
    expect(r.ok && r.decision).toBe("counter_offer");
    expect(codes(r)).toEqual(["OUTSIDE_AVAILABILITY:alice"]);
  });
  it("CORE-14 touching rules join; a gap does not", () => {
    const joined = run(
      scenario({ start: "11:30", end: "12:30", parties: split({ monday: [day("09:00", "12:00"), day("12:00", "17:00")] }) }),
    );
    expect(joined.ok && joined.decision).toBe("book");
    const gap = run(
      scenario({ start: "11:30", end: "12:30", parties: split({ monday: [day("09:00", "12:00"), day("12:01", "17:00")] }) }),
    );
    expect(gap.ok && gap.decision).toBe("counter_offer");
  });
  it("CORE-15 end boundary is inclusive", () => {
    const p = split({ monday: [day("09:00", "17:00")] });
    const at = run(scenario({ start: "16:00", end: "17:00", parties: p }));
    expect(at.ok && at.decision).toBe("book");
    const over = run(scenario({ start: "16:00", end: "17:01", parties: p }));
    expect(over.ok && over.decision).toBe("counter_offer");
  });
  it("Review Focus 4: 23:30-00:00 against a 24:00 end", () => {
    const r = run(scenario({ start: "23:30", end: "00:00", parties: split({ monday: [day("09:00", "24:00")] }) }));
    expect(r.ok && r.decision).toBe("book");
  });
  it("Review Focus 4: request spanning the join of two rules", () => {
    const r = run(
      scenario({
        start: "23:30",
        end: "00:30",
        parties: [
          utc("alice", { monday: [day("09:00", "24:00")], tuesday: [day("00:00", "08:00")] }),
          utc("bob", { monday: [day("00:00", "24:00")], tuesday: [day("00:00", "24:00")] }),
        ],
      }),
    );
    expect(r.ok && r.decision).toBe("book");
  });
});

describe("CORE-17 overnight blackout ownership", () => {
  const mk = (blackout: string) =>
    scenario({
      start: "01:00",
      end: "02:00",
      parties: [
        utc("alice", { sunday: [day("22:00", "06:00")] }, [blackout]),
        utc("bob", { monday: [day("00:00", "24:00")] }),
      ],
    });
  it("blackout on the day the request falls does not matter", () => {
    const r = run(mk("2025-01-06"));
    expect(r.ok && r.decision).toBe("book");
  });
  it("blackout on the owning sunday blocks", () => {
    const r = run(mk("2025-01-05"));
    expect(r.ok && r.decision).toBe("counter_offer");
    expect(r.ok && r.reasons).toEqual([
      {
        code: "IN_BLACKOUT",
        participantId: "alice",
        message: "alice: availability is blocked by blackout date 2025-01-05.",
      },
    ]);
  });
});

describe("CORE-19..21", () => {
  const always = { monday: [day("00:00", "24:00")] };
  it("CORE-19 weekend-only rules book on Saturday and Sunday", () => {
    for (const date of ["2025-01-04", "2025-01-05"]) {
      const rules = { saturday: [day("09:00", "17:00")], sunday: [day("09:00", "17:00")] };
      const r = run(scenario({ date, start: "10:00", end: "11:00", parties: [utc("alice", rules), utc("bob", rules)] }));
      expect(r.ok && r.decision).toBe("book");
    }
  });
  it("CORE-20 empty weeklyRules is OUTSIDE_AVAILABILITY", () => {
    const r = run(scenario({ start: "10:00", end: "11:00", parties: [utc("alice", {}), utc("bob", always)] }));
    expect(codes(r)).toEqual(["OUTSIDE_AVAILABILITY:alice"]);
  });
  it("CORE-21 blackout vs outside, one reason per participant", () => {
    const r = run(
      scenario({
        start: "10:00",
        end: "11:00",
        parties: [
          utc("alice", always, ["2025-01-06"]),
          utc("bob", { tuesday: [day("09:00", "17:00")] }, ["2025-01-07"]),
        ],
      }),
    );
    expect(codes(r)).toEqual(["IN_BLACKOUT:alice", "OUTSIDE_AVAILABILITY:bob"]);
  });
  it("CORE-21 a rule that is blacked out but does not cover the request stays OUTSIDE_AVAILABILITY", () => {
    // 10:00-10:30 is blacked out on the day, but the request 10:00-11:00 was never inside any rule.
    const r = run(
      scenario({
        start: "10:00",
        end: "11:00",
        parties: [utc("alice", { monday: [day("10:00", "10:30")] }, ["2025-01-06"]), utc("bob", always)],
      }),
    );
    expect(codes(r)).toEqual(["OUTSIDE_AVAILABILITY:alice"]);
  });
});

describe("IN_BLACKOUT names the earliest blocked instance", () => {
  const msgFor = (blackouts: string[]) => {
    const r = run(
      scenario({
        date: "2025-01-06",
        start: "01:00",
        end: "02:00",
        parties: [
          utc("alice", { sunday: [day("22:00", "06:00")], monday: [day("00:00", "24:00")] }, blackouts),
          utc("bob", { monday: [day("00:00", "24:00")] }),
        ],
      }),
    );
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    return r.reasons.map((x) => x.message);
  };
  it("a Sunday overnight shift and a Monday shift both blocked: the earlier owner date wins", () => {
    expect(msgFor(["2025-01-05", "2025-01-06"])).toEqual([
      "alice: availability is blocked by blackout date 2025-01-05.",
    ]);
    expect(msgFor(["2025-01-06", "2025-01-05"])).toEqual([
      "alice: availability is blocked by blackout date 2025-01-05.",
    ]);
  });
  it("two blocked rules with the same start are ordered by end and still give one reason", () => {
    const r = run(
      scenario({
        start: "10:00",
        end: "11:00",
        parties: [
          utc("alice", { monday: [day("10:00", "12:00"), day("10:00", "11:00")] }, ["2025-01-06"]),
          utc("bob", { monday: [day("00:00", "24:00")] }),
        ],
      }),
    );
    expect(codes(r)).toEqual(["IN_BLACKOUT:alice"]);
  });
});

describe("gate reasons first (CORE-22/23)", () => {
  const parties = [utc("alice", { monday: [day("09:00", "10:00")] }), utc("bob", { monday: [day("09:00", "17:00")] })];
  it("IN_PAST then participant reasons", () => {
    const r = run(scenario({ start: "09:30", end: "10:30", now: "2025-01-06T12:00:00Z", parties }));
    expect(codes(r)).toEqual(["IN_PAST:", "OUTSIDE_AVAILABILITY:alice"]);
    expect(r.ok && r.reasons[0]?.message).toBe("Requested start 2025-01-06T09:30:00Z is before now 2025-01-06T12:00:00Z.");
  });
  it("INSUFFICIENT_NOTICE then participant reasons", () => {
    const r = run(scenario({ start: "09:30", end: "10:30", now: "2025-01-06T09:00:00Z", minNotice: 60, parties }));
    expect(codes(r)).toEqual(["INSUFFICIENT_NOTICE:", "OUTSIDE_AVAILABILITY:alice"]);
    expect(r.ok && r.reasons[0]?.message).toBe(
      "Requested start 2025-01-06T09:30:00Z is earlier than now plus 60 minutes (2025-01-06T10:00:00Z).",
    );
  });
  it("gate failure alone is a counter_offer with no slots", () => {
    const r = run(scenario({ start: "09:30", end: "09:45", now: "2025-01-06T12:00:00Z", parties }));
    expect(r.ok && r.decision).toBe("counter_offer");
    expect(r.ok && r.slots).toEqual([]);
    expect(codes(r)).toEqual(["IN_PAST:"]);
  });
});

describe("hostile input (never throws)", () => {
  const thrower = {
    get request(): never {
      throw new Error("boom");
    },
    participants: [],
    options: {},
  };
  it.each([
    ["null", null],
    ["42", 42],
    ['"x"', "x"],
    ["[]", []],
    ["{}", {}],
    ["throwing getter", thrower],
  ])("%s -> INVALID_INPUT", (_n, v) => {
    const r = run(v);
    expect(r.ok === false && r.error.code).toBe("INVALID_INPUT");
  });
  it("a non-object type is a compile error", () => {
    // @ts-expect-error evaluate takes a NegotiationRequest
    const r = evaluate("x");
    expect(r.ok).toBe(false);
  });
});

describe("determinism and ordering", () => {
  it("participant order does not matter; reasons follow partyId", () => {
    const parties = [
      utc("bob", { tuesday: [day("09:00", "17:00")] }),
      utc("alice", { tuesday: [day("09:00", "17:00")] }),
    ];
    const a = run(scenario({ start: "10:00", end: "11:00", parties }));
    const b = run(scenario({ start: "10:00", end: "11:00", parties: [...parties].reverse() }));
    expect(a).toEqual(b);
    expect(codes(a)).toEqual(["OUTSIDE_AVAILABILITY:alice", "OUTSIDE_AVAILABILITY:bob"]);
  });
  it("two calls are identical", () => {
    const a = run(validRequest());
    const b = run(validRequest());
    expect(a).toStrictEqual(b);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
