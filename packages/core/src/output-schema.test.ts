import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CheckReasonCodeSchema,
  ErrorCodeSchema,
  ErrorResultSchema,
  ExplainResultSchema,
  NegotiationRequestSchema,
  NegotiationResultSchema,
  ReasonCodeSchema,
  ReasonSchema,
} from "./schema.js";

interface Fixture {
  id: string;
  entry: string;
  input: unknown;
  expected: Record<string, unknown>;
}

function fixture(name: string): Fixture {
  const path = resolve(import.meta.dirname, "../fixtures/examples", `${name}.json`);
  return JSON.parse(readFileSync(path, "utf8")) as Fixture;
}

const ex01 = fixture("ex-01");
const ex10 = fixture("ex-10");
const ex22 = fixture("ex-22");

describe("CORE-44 closed enums", () => {
  it("ErrorCodeSchema has exactly the 7 codes, in order", () => {
    expect(ErrorCodeSchema.options).toEqual([
      "INVALID_INPUT",
      "INVALID_ZONE",
      "AMBIGUOUS_ZONE",
      "INVALID_INTERVAL",
      "DST_NONEXISTENT_LOCAL_TIME",
      "DST_AMBIGUOUS_LOCAL_TIME",
      "INTERNAL_ERROR",
    ]);
  });

  it("ReasonCodeSchema has the 6 codes and no OK", () => {
    expect(ReasonCodeSchema.options).toEqual([
      "IN_PAST",
      "INSUFFICIENT_NOTICE",
      "OUTSIDE_AVAILABILITY",
      "IN_BLACKOUT",
      "NO_SLOTS_IN_HORIZON",
      "DST_RULE_ADJUSTED",
    ]);
    expect(ReasonCodeSchema.options).not.toContain("OK");
  });

  it("CheckReasonCodeSchema is OK, OUTSIDE_AVAILABILITY, IN_BLACKOUT", () => {
    expect(CheckReasonCodeSchema.options).toEqual(["OK", "OUTSIDE_AVAILABILITY", "IN_BLACKOUT"]);
  });
});

describe("CORE-44 SPEC fixtures", () => {
  it("EX-01 input is a valid request and expected is a NegotiationResult", () => {
    expect(NegotiationRequestSchema.safeParse(ex01.input).success).toBe(true);
    expect(NegotiationResultSchema.safeParse(ex01.expected).success).toBe(true);
  });

  it("EX-10 expected is an ErrorResult and a NegotiationResult", () => {
    expect(ErrorResultSchema.safeParse(ex10.expected).success).toBe(true);
    expect(NegotiationResultSchema.safeParse(ex10.expected).success).toBe(true);
  });

  it("EX-22 expected is an ExplainResult", () => {
    expect(ex22.entry).toBe("explain");
    expect(ExplainResultSchema.safeParse(ex22.expected).success).toBe(true);
  });
});

describe("CORE-44 rejections", () => {
  it("rejects decision needs_clarification", () => {
    expect(
      NegotiationResultSchema.safeParse({ ...ex01.expected, decision: "needs_clarification" })
        .success,
    ).toBe(false);
  });

  it("rejects a reason with code OK", () => {
    expect(ReasonSchema.safeParse({ code: "OK", message: "x" }).success).toBe(false);
    expect(
      NegotiationResultSchema.safeParse({
        ...ex01.expected,
        reasons: [{ code: "OK", message: "x" }],
      }).success,
    ).toBe(false);
  });

  it("rejects an error with code INVALID_INTERNAL", () => {
    expect(
      ErrorResultSchema.safeParse({ ok: false, error: { code: "INVALID_INTERNAL", message: "x" } })
        .success,
    ).toBe(false);
  });

  it("rejects an unexpected field (strict output objects)", () => {
    expect(NegotiationResultSchema.safeParse({ ...ex01.expected, extra: 1 }).success).toBe(false);
  });

  it("rejects a malformed ruleMatched in an explain trace", () => {
    const bad = structuredClone(ex22.expected) as {
      requested: { checks: { ruleMatched: unknown }[] };
    };
    bad.requested.checks[0]!.ruleMatched = { weekday: "someday" };
    expect(ExplainResultSchema.safeParse(bad).success).toBe(false);
  });
});
