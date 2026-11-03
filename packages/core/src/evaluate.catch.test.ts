import { afterEach, describe, expect, it, vi } from "vitest";
import { validRequest } from "../test/helpers.js";
import { internalError } from "./internal-error.js";
import type { NegotiationRequest } from "./types.js";

afterEach(() => {
  vi.doUnmock("./parse.js");
  vi.doUnmock("./dst.js");
  vi.resetModules();
});

describe("evaluate split catch (A-59, superseded by G33)", () => {
  it("an exception while parsing becomes INVALID_INPUT, never a throw", async () => {
    vi.resetModules();
    vi.doMock("./parse.js", () => ({
      parseNegotiationRequest: () => {
        throw new Error("parse bug");
      },
    }));
    const { evaluate } = await import("./evaluate.js");
    expect(evaluate(validRequest() as NegotiationRequest)).toEqual({
      ok: false,
      error: {
        code: "INVALID_INPUT",
        message: "Input could not be read.",
        details: { issues: [{ path: "$", message: "Input could not be read." }] },
      },
    });
  });

  it("an exception after the input was accepted becomes INTERNAL_ERROR without leaking the message", async () => {
    vi.resetModules();
    vi.doMock("./dst.js", async (orig) => ({
      ...(await orig<typeof import("./dst.js")>()),
      findDstError: () => {
        throw new Error("secret");
      },
    }));
    const { evaluate } = await import("./evaluate.js");
    const r = evaluate(validRequest() as NegotiationRequest);
    expect(r).toEqual(internalError());
    expect(JSON.stringify(r)).not.toContain("secret");
  });
});
