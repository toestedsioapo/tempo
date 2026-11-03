import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { renderRulesJsonSchema } from "./rules-schema.js";

// packages/core/scripts -> repo root. The string is LF-only; writeFileSync does not translate.
const outDir = join(resolve(import.meta.dirname, "../../.."), "schema");
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "rules.schema.json"), renderRulesJsonSchema());
