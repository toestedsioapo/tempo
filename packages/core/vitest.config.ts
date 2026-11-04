import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "json-summary"],
      // M2b widened the A-58 gate to all of core (QG-01): every source file except tests and the
      // `index.ts` re-export barrel (no logic) and the type-only `types.ts`.
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/index.ts", "src/types.ts"],
      thresholds: { lines: 95, branches: 95 },
    },
  },
});
