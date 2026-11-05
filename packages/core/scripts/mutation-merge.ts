import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// QG-02: merges the per-shard Stryker `mutation.json` reports and applies the break threshold to the
// combined score (a single shard can sit below it without failing the run).

export interface MutationReport {
  files: Record<
    string,
    { mutants: Array<{ id: string; mutatorName: string; status: string; location: { start: { line: number; column: number } } }> }
  >;
}

export interface Survivor {
  file: string;
  line: number;
  mutator: string;
  status: string;
}

interface Counts {
  detected: number;
  undetected: number;
  score: number;
}

export interface MergedReport extends Counts {
  files: Record<string, Counts>;
  survivors: Survivor[];
}

const DETECTED = new Set(["Killed", "Timeout"]);
const UNDETECTED = new Set(["Survived", "NoCoverage"]);

const score = (detected: number, undetected: number): number =>
  detected + undetected === 0 ? 100 : (detected / (detected + undetected)) * 100;

export function mergeMutationReports(reports: MutationReport[]): MergedReport {
  const files: Record<string, Counts> = {};
  const survivors: Survivor[] = [];
  for (const report of reports) {
    for (const [file, { mutants }] of Object.entries(report.files)) {
      const c = (files[file] ??= { detected: 0, undetected: 0, score: 100 });
      for (const mu of mutants) {
        if (DETECTED.has(mu.status)) c.detected += 1;
        else if (UNDETECTED.has(mu.status)) {
          c.undetected += 1;
          survivors.push({ file, line: mu.location.start.line, mutator: mu.mutatorName, status: mu.status });
        }
      }
      c.score = score(c.detected, c.undetected);
    }
  }
  const detected = Object.values(files).reduce((n, c) => n + c.detected, 0);
  const undetected = Object.values(files).reduce((n, c) => n + c.undetected, 0);
  survivors.sort((a, b) => (a.file === b.file ? a.line - b.line : a.file < b.file ? -1 : 1));
  return { detected, undetected, score: score(detected, undetected), files, survivors };
}

function findReports(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? findReports(join(dir, e.name)) : e.name === "mutation.json" ? [join(dir, e.name)] : [],
  );
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [dir, configPath, outPath] = process.argv.slice(2);
  if (dir === undefined || configPath === undefined || !existsSync(dir)) {
    console.error("usage: mutation-merge <reports-dir> <stryker.config.json> [merged.json]");
    process.exit(2);
  }
  const paths = findReports(dir);
  if (paths.length === 0) {
    console.error(`mutation-merge: no mutation.json under ${dir}`);
    process.exit(2);
  }
  const merged = mergeMutationReports(paths.map((p) => JSON.parse(readFileSync(p, "utf8")) as MutationReport));
  const breakAt = (JSON.parse(readFileSync(configPath, "utf8")) as { thresholds: { break: number } }).thresholds.break;
  for (const [file, c] of Object.entries(merged.files)) console.log(`${c.score.toFixed(2).padStart(7)}%  ${c.detected}/${c.detected + c.undetected}  ${file}`);
  console.log(`combined ${merged.score.toFixed(2)}% (${merged.detected} detected, ${merged.undetected} undetected, ${paths.length} shards), break at ${breakAt}%`);
  if (outPath !== undefined) writeFileSync(outPath, `${JSON.stringify(merged, null, 2)}\n`);
  if (merged.score < breakAt) {
    console.error(`mutation-merge: combined score ${merged.score.toFixed(2)}% is below the break threshold ${breakAt}%`);
    process.exit(1);
  }
}
