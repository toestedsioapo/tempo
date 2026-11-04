import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(resolve(import.meta.dirname, "../../../.github/workflows/nightly.yml"), "utf8");

describe("CFG: nightly property workflow (A-65)", () => {
  it("runs on a schedule and on demand", () => {
    expect(workflow).toMatch(/schedule:\s*\n\s*- cron: "0 3 \* \* \*"/);
    expect(workflow).toContain("workflow_dispatch");
  });

  it("sets TEMPO_PROP_RUNS to 5000 and runs the whole test suite on Node 24", () => {
    expect(workflow).toMatch(/TEMPO_PROP_RUNS: "5000"/);
    expect(workflow).toContain("node-version: 24");
    expect(workflow).toContain("pnpm install --frozen-lockfile");
    expect(workflow).toMatch(/- run: pnpm test\s*$/m);
  });
});
