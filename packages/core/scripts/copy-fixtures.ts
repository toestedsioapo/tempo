// Fixtures ship straight from packages/core/fixtures (package.json "files" + the "./fixtures/*" export, A-89),
// so there is nothing to copy. This guard runs in build/prepack: it fails if the lock is stale.
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { LOCK_NAME, lockFixtures } from "./lock-fixtures.js";

const dir = resolve(import.meta.dirname, "../fixtures");
const committed = JSON.parse(readFileSync(join(dir, LOCK_NAME), "utf8")) as Record<string, string>;
if (JSON.stringify(lockFixtures(dir)) !== JSON.stringify(committed)) {
  console.error("copy-fixtures: fixtures.lock.json is stale. Run `pnpm --filter @marvinliem/tempo-core lock:fixtures`.");
  process.exit(1);
}
