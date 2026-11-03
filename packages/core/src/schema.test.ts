import { describe, expect, it } from "vitest";
import {
  ClockTimeSchema,
  DAY_NAMES,
  DayNameSchema,
  EndTimeSchema,
  LocalDateSchema,
  UtcInstantSchema,
  ZoneIdSchema,
  NegotiationRequestSchema,
} from "./schema.js";
import { formatIssuePath } from "./issues.js";
import { validRequest, withChange } from "../test/helpers.js";

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
      ["2025-01-03T24:00:00Z", false],
      ["2025-01-03T12:60:00Z", false],
      ["2025-01-03T12:00:60Z", false],
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
  it("accepts any string; zone validity is checked in zones.ts (A-51)", () => {
    expect(ZoneIdSchema.safeParse("Europe/Berlin").success).toBe(true);
    expect(ZoneIdSchema.safeParse("").success).toBe(true);
  });
});

type Doc = { request: Record<string, string>; participants: Record<string, unknown>[] };
const parse = (change: unknown) => NegotiationRequestSchema.safeParse(change);
const firstPath = (change: unknown): string => {
  const r = parse(change);
  if (r.success) throw new Error("expected rejection");
  return formatIssuePath(r.error.issues[0]!.path);
};

describe("NegotiationRequestSchema rejections", () => {
  const p0 = (k: string, v: unknown) => withChange(["participants", 0, k], v);
  const many = (n: number) => {
    const base = validRequest() as { participants: { partyId: string }[] };
    const first = base.participants[0]!;
    base.participants = Array.from({ length: n }, (_, i) => ({ ...first, partyId: `p${i}` }));
    return base;
  };
  const rows: [string, unknown, string][] = [
    ["one participant", withChange(["participants"], [(validRequest() as Doc).participants[0]]), "participants"],
    ["51 participants", many(51), "participants"],
    ["duplicate partyId", withChange(["participants", 1, "partyId"], "alice"), "participants[1].partyId"],
    ["empty partyId", p0("partyId", ""), "participants[0].partyId"],
    ["65-char partyId", p0("partyId", "a".repeat(65)), "participants[0].partyId"],
    ["request.start 24:00", withChange(["request", "start"], "24:00"), "request.start"],
    ["request.end 24:00", withChange(["request", "end"], "24:00"), "request.end"],
    ["rule start 24:00", withChange(["participants", 0, "weeklyRules", "monday", 0, "start"], "24:00"), "participants[0].weeklyRules.monday[0].start"],
    ["weekday Monday", withChange(["participants", 0, "weeklyRules", "Monday"], []), "participants[0].weeklyRules"],
    ["weekday mon", withChange(["participants", 0, "weeklyRules", "mon"], []), "participants[0].weeklyRules"],
    ["weekday 1", withChange(["participants", 0, "weeklyRules", "1"], []), "participants[0].weeklyRules"],
    ["extra top-level key", withChange(["extra"], 1), "$"],
    ["blackout 2025-02-30", p0("blackouts", ["2025-02-30"]), "participants[0].blackouts[0]"],
    ["options.now offset", withChange(["options", "now"], "2025-01-03T12:00:00+00:00"), "options.now"],
    ["options.now epoch", withChange(["options", "now"], "1735905600"), "options.now"],
    ["options.now millis", withChange(["options", "now"], "2025-01-03T12:00:00.000Z"), "options.now"],
    ["options.now missing", withChange(["options", "now"], undefined), "options.now"],
  ];
  for (const [name, value] of [
    ["searchHorizonDays", [0, 91]],
    ["searchStepMinutes", [0, 1441]],
    ["maxSuggestions", [0, 11]],
    ["minNoticeMinutes", [-1, 525601, 1.5]],
  ] as [string, number[]][]) {
    for (const v of value) {
      rows.push([`options.${name} ${v}`, withChange(["options", name], v), `options.${name}`]);
    }
  }
  it.each(rows)("%s", (_n, change, path) => {
    expect(firstPath(change)).toBe(path);
  });

  it.each([["09:00"], ["00:00"]])("request %s->%s is rejected (G23)", (t) => {
    const c = withChange(["request", "start"], t) as Doc;
    c.request.end = t;
    const r = parse(c);
    if (r.success) throw new Error("expected rejection");
    const issue = r.error.issues[0]!;
    expect(formatIssuePath(issue.path)).toBe("request.end");
    expect(issue.message).toBe("Request start and end must differ.");
  });

  it("extra misspelt key timezone: first issue is on the participant", () => {
    const r = parse(withChange(["participants", 0, "timezone"], "Europe/Paris"));
    if (r.success) throw new Error("expected rejection");
    const issue = r.error.issues[0]!;
    expect(formatIssuePath(issue.path)).toBe("participants[0]");
    expect(issue.message).toContain("timezone");
  });

  it("renamed key timeZone->timezone: unrecognized key is reported (after the missing field)", () => {
    const c = withChange(["participants", 0, "timeZone"], undefined) as Doc;
    c.participants[0]!.timezone = "Europe/Paris";
    const r = parse(c);
    if (r.success) throw new Error("expected rejection");
    expect(formatIssuePath(r.error.issues[0]!.path)).toBe("participants[0].timeZone");
    const issue = r.error.issues.find((i) => i.message.includes("timezone"));
    expect(issue && formatIssuePath(issue.path)).toBe("participants[0]");
  });
});

describe("NegotiationRequestSchema acceptances", () => {
  const ok = (c: unknown) => expect(parse(c).success).toBe(true);
  it("overnight request 23:00->01:00", () => {
    const c = withChange(["request", "start"], "23:00") as Doc;
    c.request.end = "01:00";
    ok(c);
  });
  it("request 09:00->08:59", () => {
    const c = withChange(["request", "start"], "09:00") as Doc;
    c.request.end = "08:59";
    ok(c);
  });
  it("rule end 24:00", () => ok(withChange(["participants", 0, "weeklyRules", "monday", 0, "end"], "24:00")));
  it("rule 09:00-09:00 (A-37)", () => {
    ok(withChange(["participants", 0, "weeklyRules", "monday"], [{ start: "09:00", end: "09:00" }]));
  });
  it("empty weeklyRules", () => ok(withChange(["participants", 0, "weeklyRules"], {})));
  it("50 participants", () => {
    const base = validRequest() as Doc;
    base.participants = Array.from({ length: 50 }, (_, i) => ({ ...base.participants[0], partyId: `p${i}` }));
    ok(base);
  });
  it("64-char partyId", () => ok(withChange(["participants", 0, "partyId"], "a".repeat(64))));

  it("CORE-01 defaults", () => {
    const r = parse(validRequest());
    if (!r.success) throw new Error("expected success");
    expect(r.data.options).toEqual({
      now: "2025-01-03T12:00:00Z",
      minNoticeMinutes: 0,
      searchHorizonDays: 14,
      searchStepMinutes: 15,
      maxSuggestions: 3,
    });
    for (const p of r.data.participants) expect(p.blackouts).toEqual([]);
  });
});
