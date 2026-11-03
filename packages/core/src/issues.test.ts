import { describe, expect, it } from "vitest";
import { formatIssuePath } from "./issues.js";

describe("formatIssuePath", () => {
  it.each([
    [["participants", 1, "partyId"], "participants[1].partyId"],
    [[], "$"],
    [["request"], "request"],
    [["participants", 0, "weeklyRules", "monday", 0, "start"], "participants[0].weeklyRules.monday[0].start"],
  ] as [PropertyKey[], string][])("%j -> %s", (path, expected) => {
    expect(formatIssuePath(path)).toBe(expected);
  });
});
