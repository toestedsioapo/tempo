import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** `owned`: the name exists on npm and the given owner is one of its maintainers (our own earlier release). */
export type NameStatus = "available" | "taken" | "owned" | "unknown";

export function classifyStatus(status: number): NameStatus {
  if (status === 404) return "available";
  if (status === 200) return "taken";
  return "unknown";
}

async function isMaintainedBy(res: Response, owner: string): Promise<boolean> {
  try {
    const body: unknown = await res.json();
    const maintainers = (body as { maintainers?: unknown } | null)?.maintainers;
    return Array.isArray(maintainers) && maintainers.some((m) => (m as { name?: unknown } | null)?.name === owner);
  } catch {
    return false; // never guess ownership
  }
}

export async function checkNames(
  names: readonly string[],
  fetchFn: typeof fetch,
  owner?: string,
): Promise<{ name: string; status: NameStatus }[]> {
  return Promise.all(
    names.map(async (name) => {
      try {
        const res = await fetchFn(`https://registry.npmjs.org/${name.replaceAll("/", "%2F")}`);
        const status = classifyStatus(res.status);
        if (status === "taken" && owner !== undefined && (await isMaintainedBy(res, owner))) {
          return { name, status: "owned" as const };
        }
        return { name, status };
      } catch {
        return { name, status: "unknown" as const };
      }
    }),
  );
}

/** The gate: every name is free, or already ours. Taken by someone else, or unknown, stops the release. */
export function namesOk(results: readonly { name: string; status: NameStatus }[]): boolean {
  return results.every((r) => r.status === "available" || r.status === "owned");
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
  const results = await checkNames(["@marvinliem/tempo-core", "@marvinliem/tempo"], fetch, "marvinliem");
  for (const r of results) console.log(`${r.name}: ${r.status}`);
  if (namesOk(results)) {
    process.exitCode = 0;
    return;
  }
  console.log("ask the maintainer before continuing");
  process.exitCode = 1;
}

if (isMain()) {
  await main();
}
