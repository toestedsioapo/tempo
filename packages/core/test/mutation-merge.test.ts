import { describe, expect, it } from "vitest";
import { mergeMutationReports, type MutationReport } from "../scripts/mutation-merge.js";

const m = (id: string, status: string, line = 1): MutationReport["files"][string]["mutants"][number] => ({
  id,
  mutatorName: "ConditionalExpression",
  status,
  location: { start: { line, column: 1 } },
});

const report = (files: Record<string, string[]>): MutationReport => ({
  files: Object.fromEntries(
    Object.entries(files).map(([path, statuses]) => [path, { mutants: statuses.map((s, i) => m(`${path}-${i}`, s, i + 1)) }]),
  ),
});

describe("mergeMutationReports (QG-02 shards)", () => {
  it("counts Killed and Timeout as detected; Survived and NoCoverage as undetected", () => {
    const r = mergeMutationReports([report({ "a.ts": ["Killed", "Timeout", "Survived", "NoCoverage"] })]);
    expect(r.detected).toBe(2);
    expect(r.undetected).toBe(2);
    expect(r.score).toBe(50);
  });

  it("excludes Ignored, CompileError and RuntimeError from the score", () => {
    const r = mergeMutationReports([report({ "a.ts": ["Killed", "Ignored", "CompileError", "RuntimeError"] })]);
    expect(r.detected).toBe(1);
    expect(r.undetected).toBe(0);
    expect(r.score).toBe(100);
  });

  it("combines shards by counts, not by averaging shard scores", () => {
    const a = report({ "a.ts": ["Killed", "Killed", "Killed", "Survived"] }); // 75 %
    const b = report({ "b.ts": ["Killed", "Survived"] }); // 50 %
    const r = mergeMutationReports([a, b]);
    expect(r.detected).toBe(4);
    expect(r.undetected).toBe(2);
    expect(r.score).toBeCloseTo(66.666, 2);
  });

  it("reports a per-file score and lists survivors with file, line and mutator", () => {
    const r = mergeMutationReports([report({ "a.ts": ["Killed", "Survived"], "b.ts": ["Killed"] })]);
    expect(r.files["a.ts"]).toMatchObject({ detected: 1, undetected: 1, score: 50 });
    expect(r.files["b.ts"]).toMatchObject({ score: 100 });
    expect(r.survivors).toEqual([{ file: "a.ts", line: 2, mutator: "ConditionalExpression", status: "Survived" }]);
  });

  it("an empty set of mutants scores 100 (nothing to detect), never NaN", () => {
    expect(mergeMutationReports([]).score).toBe(100);
  });
});
