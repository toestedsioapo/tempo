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
  },
});
