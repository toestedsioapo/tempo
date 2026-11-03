/** Render a Zod issue path: `["participants",1,"partyId"]` -> `participants[1].partyId`; `[]` -> `$`. */
export function formatIssuePath(path: readonly PropertyKey[]): string {
  if (path.length === 0) return "$";
  let out = "";
  for (const seg of path) {
    if (typeof seg === "number") out += `[${seg}]`;
    else out += out === "" ? String(seg) : `.${String(seg)}`;
  }
  return out;
}
