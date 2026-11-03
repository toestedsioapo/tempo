import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "json-summary"],
      // M2a gate (A-58): only the files added in M2a; M2b widens it to all of core.
      include: [
        "src/zones.ts",
        "src/intervals.ts",
        "src/render.ts",
        "src/reasons.ts",
        "src/gates.ts",
        "src/evaluate.ts",
      ],
      thresholds: { lines: 95, branches: 95 },
    },
  },
});
