import { describe, expect, it, vi } from "vitest";
import { validRequest } from "../test/helpers.js";
import type { NegotiationRequest } from "./types.js";

vi.mock("./parse.js", () => ({
  parseNegotiationRequest: () => {
    throw new Error("engine bug");
  },
}));

describe("evaluate outer catch (A-59)", () => {
  it("an unexpected exception inside the engine becomes INVALID_INPUT, never a throw", async () => {
    const { evaluate } = await import("./evaluate.js");
    const r = evaluate(validRequest() as NegotiationRequest);
    expect(r).toEqual({
      ok: false,
      error: {
        code: "INVALID_INPUT",
        message: "Input could not be read.",
        details: { issues: [{ path: "$", message: "Input could not be read." }] },
      },
    });
  });
});
