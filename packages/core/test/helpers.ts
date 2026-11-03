/** Test-only helpers. The EX-01 input as untyped JSON. */
export function validRequest(): unknown {
  const weeklyRules = { monday: [{ start: "09:00", end: "17:00" }] };
  return {
    request: { date: "2025-01-06", start: "09:30", end: "10:30", timeZone: "America/New_York" },
    participants: [
      { partyId: "alice", timeZone: "America/New_York", weeklyRules },
      { partyId: "bob", timeZone: "Europe/London", weeklyRules },
    ],
    options: { now: "2025-01-03T12:00:00Z" },
  };
}

/** Deep clone of `validRequest()` with one value set; `undefined` deletes the key. */
export function withChange(path: readonly (string | number)[], value: unknown): unknown {
  const root = validRequest() as Record<string | number, unknown>;
  let node = root;
  for (const key of path.slice(0, -1)) node = node[key] as Record<string | number, unknown>;
  const last = path[path.length - 1] as string | number;
  if (value === undefined) delete node[last];
  else node[last] = value;
  return root;
}
