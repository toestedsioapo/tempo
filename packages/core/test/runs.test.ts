import { afterEach, describe, expect, it } from "vitest";
import { propRuns, propTimeoutMs } from "./runs.js";

describe("propRuns (A-65)", () => {
  const saved = process.env["TEMPO_PROP_RUNS"];
  afterEach(() => {
    if (saved === undefined) delete process.env["TEMPO_PROP_RUNS"];
    else process.env["TEMPO_PROP_RUNS"] = saved;
  });

  it("defaults to 200 and reads TEMPO_PROP_RUNS", () => {
    delete process.env["TEMPO_PROP_RUNS"];
    expect(propRuns()).toBe(200);
    process.env["TEMPO_PROP_RUNS"] = "5000";
    expect(propRuns()).toBe(5000);
    expect(propTimeoutMs()).toBe(5_060_000);
  });

  it("falls back to 200 for junk", () => {
    for (const bad of ["", "abc", "-5", "0", "1.5"]) {
      process.env["TEMPO_PROP_RUNS"] = bad;
      expect(propRuns()).toBe(200);
    }
  });
});
