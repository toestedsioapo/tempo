import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { validRequest, withChange } from "../test/helpers.js";
import { parseNegotiationRequest } from "./parse.js";

const ex10 = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "../fixtures/examples/ex-10.json"), "utf8"),
) as { input: unknown; expected: unknown };

describe("parseNegotiationRequest", () => {
  it("EX-10 input yields the exact expected error", () => {
    expect(parseNegotiationRequest(ex10.input)).toEqual(ex10.expected);
  });

  it("CORE-02: one participant reports path participants", () => {
    const r = parseNegotiationRequest(
      withChange(["participants"], [(validRequest() as { participants: unknown[] }).participants[0]]),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.details).toBeDefined();
    const issues = (r.error.details as { issues: { path: string }[] }).issues;
    expect(issues[0]?.path).toBe("participants");
  });

  it("valid request returns { ok: true, value } with defaults applied", () => {
    const r = parseNegotiationRequest(validRequest());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.options.maxSuggestions).toBe(3);
  });

  const exotic: [string, unknown, string | undefined][] = [
    ["null", null, "$"],
    ["undefined", undefined, undefined],
    ["42", 42, "$"],
    ['"x"', "x", "$"],
    ["[]", [], "$"],
    ["{}", {}, undefined],
    ["own __proto__", JSON.parse('{"__proto__":{}}'), undefined],
    ["nested own __proto__", JSON.parse('{"request":{"__proto__":1}}'), undefined],
  ];
  it.each(exotic)("never throws on %s", (_name, input, firstPath) => {
    let r: ReturnType<typeof parseNegotiationRequest> | undefined;
    expect(() => {
      r = parseNegotiationRequest(input);
    }).not.toThrow();
    expect(r?.ok).toBe(false);
    if (!r || r.ok) return;
    expect(r.error.code).toBe("INVALID_INPUT");
    const issues = (r.error.details as { issues: { path: string; message: string }[] }).issues;
    expect(issues.length).toBeGreaterThan(0);
    expect(r.error.message).toBe(issues[0]?.message);
    if (firstPath !== undefined) expect(issues[0]?.path).toBe(firstPath);
  });

  it("hostile input (throwing getter, throwing Proxy) is INVALID_INPUT at $", () => {
    const getter = {
      get request(): never {
        throw new Error("boom");
      },
    };
    const proxy = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error("trap");
        },
        get() {
          throw new Error("trap");
        },
      },
    );
    for (const input of [getter, proxy]) {
      const r = parseNegotiationRequest(input);
      expect(r).toMatchObject({ ok: false, error: { code: "INVALID_INPUT" } });
      if (r.ok) return;
      expect((r.error.details as { issues: { path: string }[] }).issues[0]?.path).toBe("$");
    }
  });

  it("is deterministic", () => {
    const bad = withChange(["participants"], []);
    expect(parseNegotiationRequest(bad)).toStrictEqual(parseNegotiationRequest(bad));
  });
});
