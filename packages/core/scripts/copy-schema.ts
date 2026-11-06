import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

// Copies the generated root schema into the package so the tarball can ship it (A-82).
// packages/core/scripts -> repo root. The root file stays canonical; this copy is gitignored.
const source = join(resolve(import.meta.dirname, "../../.."), "schema", "rules.schema.json");
// `--out <dir>` redirects the copy (tests use a private temp dir so they never share a file).
const outFlag = process.argv.indexOf("--out");
const outDir = outFlag >= 0 ? resolve(process.argv[outFlag + 1] ?? "") : join(resolve(import.meta.dirname, ".."), "schema");

if (!existsSync(source)) {
  console.error(`copy-schema: ${source} is missing. Run \`pnpm gen:schema\` first.`);
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });
const target = join(outDir, "rules.schema.json");
// Do not rewrite an identical file: concurrent test files and Windows file locks make a needless write
// fail with EBUSY.
if (!existsSync(target) || !readFileSync(source).equals(readFileSync(target))) copyFileSync(source, target);
