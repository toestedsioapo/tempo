import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

export type NameStatus = "available" | "taken" | "unknown";

export function classifyStatus(status: number): NameStatus {
  if (status === 404) return "available";
  if (status === 200) return "taken";
  return "unknown";
}

export async function checkNames(
  names: readonly string[],
  fetchFn: typeof fetch,
): Promise<{ name: string; status: NameStatus }[]> {
  return Promise.all(
    names.map(async (name) => {
      try {
        const res = await fetchFn(`https://registry.npmjs.org/${name.replaceAll("/", "%2F")}`);
        return { name, status: classifyStatus(res.status) };
      } catch {
        return { name, status: "unknown" as const };
      }
    }),
  );
}

function isMain(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const results = await checkNames(["@marvinliem/tempo-core", "@marvinliem/tempo"], fetch);
  for (const r of results) console.log(`${r.name}: ${r.status}`);
  if (results.every((r) => r.status === "available")) {
    process.exitCode = 0;
    return;
  }
  console.log("ask the maintainer before continuing");
  process.exitCode = 1;
}

if (isMain()) {
  await main();
}
