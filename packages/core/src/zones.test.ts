import { describe, expect, it } from "vitest";
import { validRequest } from "../test/helpers.js";
import { ZONE_ABBREVIATIONS, validateZone, validateZones } from "./zones.js";
import type { ResolvedNegotiationRequest } from "./types.js";

const TABLE: [string, string[]][] = [
  ["IST", ["Asia/Kolkata", "Europe/Dublin", "Asia/Jerusalem"]],
  ["CST", ["America/Chicago", "Asia/Shanghai", "America/Havana"]],
  ["BST", ["Europe/London", "Asia/Dhaka"]],
  ["EST", ["America/New_York", "America/Toronto", "Australia/Sydney"]],
  ["PST", ["America/Los_Angeles", "Asia/Manila", "Asia/Karachi"]],
  ["MST", ["America/Denver", "America/Phoenix"]],
  ["HST", ["Pacific/Honolulu", "America/Adak"]],
];

describe("CORE-08: ambiguous abbreviations", () => {
  it("table has exactly the seven SPEC section 7 rows", () => {
    expect(Object.keys(ZONE_ABBREVIATIONS)).toEqual(TABLE.map(([k]) => k));
  });
  it.each(TABLE)("%s -> AMBIGUOUS_ZONE with options in order", (abbr, options) => {
    expect(validateZone(abbr, "request.timeZone")).toEqual({
      ok: false,
      error: {
        code: "AMBIGUOUS_ZONE",
        message: `Time zone abbreviation "${abbr}" is ambiguous; use an IANA zone.`,
        details: { field: "request.timeZone", value: abbr, options },
      },
    });
  });
});

describe("CORE-09: accepted and case-insensitive", () => {
  it.each(["UTC", "GMT", "Etc/UTC", "Europe/London", "CET"])("%s is accepted", (z) => {
    expect(validateZone(z, "f")).toBeNull();
  });
  it.each(["ist", "Ist"])("%s is ambiguous, value as written", (z) => {
    const r = validateZone(z, "f");
    expect(r?.error.code).toBe("AMBIGUOUS_ZONE");
    expect(r?.error.details).toEqual({
      field: "f",
      value: z,
      options: ["Asia/Kolkata", "Europe/Dublin", "Asia/Jerusalem"],
    });
  });
});

describe("CORE-10: invalid zones", () => {
  it.each(["Mars/Olympus", "", " UTC", "UTC+3", "+05:30"])("%j -> INVALID_ZONE", (z) => {
    expect(validateZone(z, "participants[1].timeZone")).toEqual({
      ok: false,
      error: {
        code: "INVALID_ZONE",
        message: `Unknown time zone "${z}"; use an IANA zone id.`,
        details: { field: "participants[1].timeZone", value: z },
      },
    });
  });
});

describe("validateZones", () => {
  const req = (zones: { request?: string; p0?: string; p1?: string }): ResolvedNegotiationRequest => {
    const r = validRequest() as ResolvedNegotiationRequest;
    if (zones.request !== undefined) r.request.timeZone = zones.request;
    if (zones.p0 !== undefined) r.participants[0]!.timeZone = zones.p0;
    if (zones.p1 !== undefined) r.participants[1]!.timeZone = zones.p1;
    return r;
  };

  it("returns null for a valid request", () => {
    expect(validateZones(validRequest() as ResolvedNegotiationRequest)).toBeNull();
  });
  it("reports the request zone before participants (CORE-11, zone half)", () => {
    const r = validateZones(
      req({ request: "Mars/Olympus", p0: "IST" }),
    );
    expect(r?.error.code).toBe("INVALID_ZONE");
    expect(r?.error.details).toMatchObject({ field: "request.timeZone" });
  });
  it("checks participants in array order", () => {
    const r = validateZones(
      req({ p1: "IST", p0: "Mars/Olympus" }),
    );
    expect(r?.error.details).toMatchObject({ field: "participants[0].timeZone" });
    const r2 = validateZones(req({ p1: "IST" }));
    expect(r2?.error.code).toBe("AMBIGUOUS_ZONE");
    expect(r2?.error.details).toMatchObject({ field: "participants[1].timeZone" });
  });
});
