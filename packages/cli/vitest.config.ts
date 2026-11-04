import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Unit tests run against core's source, so they never test a stale `dist` (A-79).
    alias: { "@marvinliem/tempo-core": resolve(import.meta.dirname, "../core/src/index.ts") },
  },
  test: {
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    coverage: {
      // QG-01: >= 95 % lines and branches. bin.ts is the thin real-Env shell (covered by the spawned
      // tests, which v8 cannot see) and is excluded like core's index.ts barrel (A-70 style).
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/bin.ts"],
      thresholds: { lines: 95, branches: 95 },
    },
  },
});
