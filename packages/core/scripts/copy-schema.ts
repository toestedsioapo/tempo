import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

// Copies the generated root schema into the package so the tarball can ship it (A-82).
// packages/core/scripts -> repo root. The root file stays canonical; this copy is gitignored.
const source = join(resolve(import.meta.dirname, "../../.."), "schema", "rules.schema.json");
const outDir = join(resolve(import.meta.dirname, ".."), "schema");

if (!existsSync(source)) {
  console.error(`copy-schema: ${source} is missing. Run \`pnpm gen:schema\` first.`);
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });
copyFileSync(source, join(outDir, "rules.schema.json"));
