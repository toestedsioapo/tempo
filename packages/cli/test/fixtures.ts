import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface ExampleFixture {
  id: string;
  entry: "evaluate" | "suggest" | "explain";
  input: Record<string, unknown>;
  expected: Record<string, unknown>;
}

const DIR = resolve(import.meta.dirname, "../../core/fixtures/examples");

/** Loads `ex-NN.json` from core's exported fixtures (Deskbench contract). */
export function example(n: number): ExampleFixture {
  const name = `ex-${String(n).padStart(2, "0")}.json`;
  return JSON.parse(readFileSync(resolve(DIR, name), "utf8")) as ExampleFixture;
}
