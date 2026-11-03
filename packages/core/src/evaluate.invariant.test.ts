import { afterEach, describe, expect, it, vi } from "vitest";
import { validRequest } from "../test/helpers.js";
import { internalError } from "./internal-error.js";
import type { NegotiationRequest } from "./types.js";

afterEach(() => {
  vi.doUnmock("./gates.js");
  vi.resetModules();
});

describe("evaluate span invariant (G33)", () => {
  it("an inverted requested span after acceptance is INTERNAL_ERROR, not a decision or a throw", async () => {
    vi.resetModules();
    vi.doMock("./gates.js", async (orig) => ({
      ...(await orig<typeof import("./gates.js")>()),
      requestedSpan: () => ({ startMs: 10, endMs: 5 }),
    }));
    const { evaluate } = await import("./evaluate.js");
    expect(evaluate(validRequest() as NegotiationRequest)).toEqual(internalError());
  });
});
