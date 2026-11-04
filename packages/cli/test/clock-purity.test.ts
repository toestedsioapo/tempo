import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const src = resolve(import.meta.dirname, "../src");
const files = readdirSync(src, { recursive: true, encoding: "utf8" })
  .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && f !== "clock.ts")
  .map((f) => join(src, f));

describe("CLI-10: only clock.ts reads the system clock", () => {
  it("finds the source files", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files.map((f) => [f.slice(src.length + 1), f] as const))("%s has no clock read", (_name, file) => {
    const text = readFileSync(file, "utf8");
    for (const banned of ["Date.now", "new Date", "DateTime.now", "performance.now"]) {
      expect(text, banned).not.toContain(banned);
    }
  });
});
