import { describe, expect, it } from "vitest";
import type { NegotiationRequest } from "@marvinliem/tempo-core";
import type { Command } from "./args.js";
import { commands } from "./commands.js";
import { main } from "./main.js";
import { renderErrorLine, renderHuman, renderJson, type HumanResult } from "./render.js";
import { fakeEnv } from "../test/env.js";
import { example } from "../test/fixtures.js";

function resultFor(command: Command, n: number, mutate?: (input: string) => string): HumanResult {
  const text = JSON.stringify(example(n).input);
  const input = JSON.parse(mutate ? mutate(text) : text) as NegotiationRequest;
  const result = commands[command](input);
  if (!result.ok) throw new Error(`EX-${n} is not a successful computation`);
  return result;
}

const CASES: [name: string, command: Command, n: number][] = [
  ["check EX-01 (book)", "check", 1],
  ["check EX-17 (counter_offer with slots)", "check", 17],
  ["check EX-20 (INSUFFICIENT_NOTICE)", "check", 20],
  ["check EX-02 (counter_offer, no slots)", "check", 2],
  ["check EX-19 (IN_PAST with slots)", "check", 19],
  ["check EX-24 (DST_RULE_ADJUSTED note)", "check", 24],
  ["suggest EX-01 (book)", "suggest", 1],
  ["suggest EX-17", "suggest", 17],
  ["explain EX-22", "explain", 22],
  ["explain EX-01", "explain", 1],
];

describe("renderHuman: snapshots (text is not public API, A-13)", () => {
  it.each(CASES)("%s", (_name, command, n) => {
    expect(renderHuman(command, resultFor(command, n))).toMatchSnapshot();
  });
});

describe("renderHuman: invariants", () => {
  const outputs = CASES.map(([name, command, n]) => [name, renderHuman(command, resultFor(command, n))] as const);

  it.each(outputs)("%s: no tab, CR or ANSI escape; exactly one trailing newline", (_name, text) => {
    expect(text).not.toMatch(/[\t\r]/);
    expect(text).not.toContain(String.fromCharCode(27));
    expect(text.endsWith("\n")).toBe(true);
    expect(text.endsWith("\n\n")).toBe(false);
  });

  it("is ASCII except for text copied from the input (a non-ASCII partyId)", () => {
    const party = "Zoë-Ünï";
    const all = [
      ...outputs.map(([, text]) => text),
      renderHuman("explain", resultFor("explain", 22, (t) => t.replaceAll("carol", party))),
      renderHuman("check", resultFor("check", 22, (t) => t.replaceAll("carol", party))),
    ];
    expect(all.some((t) => t.includes(party))).toBe(true);
    for (const text of all) expect(text.replaceAll(party, "")).toMatch(/^[\n\x20-\x7e]*$/);
  });

  it("a result without reasons has no Reasons: block", () => {
    expect(renderHuman("check", resultFor("check", 1))).not.toContain("Reasons:");
  });

  it("a DST_RULE_ADJUSTED note is shown as a reason, not dropped", () => {
    const text = renderHuman("check", resultFor("check", 24));
    expect(text).toContain("Reasons:");
    expect(text).toContain("DST_RULE_ADJUSTED");
  });

  it("counter_offer with no slots says so", () => {
    expect(renderHuman("check", resultFor("check", 2))).toContain("No alternative slot found.");
  });

  it("check on a book does not list suggested slots; suggest does", () => {
    expect(renderHuman("check", resultFor("check", 1))).not.toContain("Suggested slots:");
    expect(renderHuman("suggest", resultFor("suggest", 1))).toContain("Suggested slots:");
  });

  it("explain shows the requested slot and a per-participant PASS/FAIL line", () => {
    const text = renderHuman("explain", resultFor("explain", 22));
    expect(text).toContain("Requested slot");
    expect(text).toMatch(/^ {2}alice: PASS {2}OK {2}monday 09:00-17:00 \(2025-01-06\)$/m);
    expect(text).toMatch(/^ {2}carol: FAIL {2}\S+ {2}/m);
  });
});

describe("main without --json", () => {
  it("prints the human rendering on stdout and nothing on stderr", async () => {
    const env = fakeEnv({ files: { "f.json": JSON.stringify(example(1).input) } });
    expect(await main(["check", "f.json"], env)).toBe(0);
    expect(env.out.join("")).toBe(renderHuman("check", resultFor("check", 1)));
    expect(env.err).toEqual([]);
  });

  it("explain and suggest use their own layouts", async () => {
    const env = fakeEnv({ files: { "f.json": JSON.stringify(example(22).input) } });
    expect(await main(["explain", "f.json"], env)).toBe(0);
    expect(env.out.join("")).toBe(renderHuman("explain", resultFor("explain", 22)));
    const env2 = fakeEnv({ files: { "f.json": JSON.stringify(example(17).input) } });
    expect(await main(["suggest", "--exit-code", "f.json"], env2)).toBe(1);
    expect(env2.out.join("")).toBe(renderHuman("suggest", resultFor("suggest", 17)));
  });

  it("an error still goes to stderr only", async () => {
    const env = fakeEnv({ files: { "f.json": "{" } });
    expect(await main(["check", "f.json"], env)).toBe(2);
    expect(env.out).toEqual([]);
    expect(env.err.join("")).toMatch(/^tempo: INVALID_INPUT: /);
  });
});

describe("render: review additions (M4 Task 1)", () => {
  it("renderJson is 2-space indented with exactly one trailing newline", () => {
    expect(renderJson({ a: [1] })).toBe('{\n  "a": [\n    1\n  ]\n}\n');
  });
  it("renderErrorLine collapses newlines and indentation into single spaces", () => {
    const line = renderErrorLine({ code: "INVALID_INPUT", message: "first\nsecond\r\n   third" });
    expect(line).toBe("tempo: INVALID_INPUT: first second third");
  });
  it("explain shows a gate other than OK as it is", () => {
    const text = renderHuman("explain", resultFor("explain", 20));
    expect(text).toMatch(/Time gate: (?!OK\b)\S+/);
  });
  it("suggest with no slots says so", () => {
    const text = renderHuman("suggest", resultFor("suggest", 2));
    expect(text).toContain("No alternative slot found.");
  });
  it("a failing check names the rule that matched, or '-' when none did", () => {
    const text = renderHuman("explain", resultFor("explain", 17));
    expect(text).toMatch(/: FAIL {2}\S+ {2}(-|\w+ \d\d:\d\d-\d\d:\d\d \(\d{4}-\d\d-\d\d\))/);
  });
});
