import { IANAZone } from "luxon";
import type { ErrorResult, ResolvedNegotiationRequest } from "./types.js";

/** SPEC section 7. Keys are upper-case; `options` keep the listed order. */
export const ZONE_ABBREVIATIONS: Readonly<Record<string, readonly string[]>> = {
  IST: ["Asia/Kolkata", "Europe/Dublin", "Asia/Jerusalem"],
  CST: ["America/Chicago", "Asia/Shanghai", "America/Havana"],
  BST: ["Europe/London", "Asia/Dhaka"],
  EST: ["America/New_York", "America/Toronto", "Australia/Sydney"],
  PST: ["America/Los_Angeles", "Asia/Manila", "Asia/Karachi"],
  MST: ["America/Denver", "America/Phoenix"],
  HST: ["Pacific/Honolulu", "America/Adak"],
};

/** Checks one zone string before Luxon sees it. Returns null when acceptable. */
export function validateZone(value: string, field: string): ErrorResult | null {
  const options = Object.hasOwn(ZONE_ABBREVIATIONS, value.toUpperCase())
    ? ZONE_ABBREVIATIONS[value.toUpperCase()]
    : undefined;
  if (options !== undefined) {
    return {
      ok: false,
      error: {
        code: "AMBIGUOUS_ZONE",
        message: `Time zone abbreviation "${value}" is ambiguous; use an IANA zone.`,
        details: { field, value, options: [...options] },
      },
    };
  }
  // Node's Intl accepts offset ids such as "+05:30"; Tempo takes IANA ids only (A-51).
  const isOffset = /^[+-]/.test(value);
  if (value === "UTC" || value === "GMT" || (!isOffset && IANAZone.isValidZone(value))) return null;
  return {
    ok: false,
    error: {
      code: "INVALID_ZONE",
      message: `Unknown time zone "${value}"; use an IANA zone id.`,
      details: { field, value },
    },
  };
}

/** Request zone first, then participants in array order. */
export function validateZones(request: ResolvedNegotiationRequest): ErrorResult | null {
  const first = validateZone(request.request.timeZone, "request.timeZone");
  if (first) return first;
  for (const [i, p] of request.participants.entries()) {
    const r = validateZone(p.timeZone, `participants[${i}].timeZone`);
    if (r) return r;
  }
  return null;
}
