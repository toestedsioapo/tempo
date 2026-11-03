import { resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import * as api from "./index.js";
import type { NegotiationRequest, ResolvedNegotiationRequest } from "./index.js";

// The public surface of @marvinliem/tempo-core is a downstream contract (Deskhand MCP, Deskbench).
// Any change to these lists must be deliberate: edit the list in the same commit and record why
// (DECISIONS.md).

const PUBLIC_VALUES = [
  "DAY_NAMES",
  "ExplainResultSchema",
  "NegotiationRequestSchema",
  "NegotiationResultSchema",
];

const PUBLIC_TYPES = [
  "CandidateTrace",
  "ClockTime",
  "DayName",
  "EndTime",
  "ErrorCode",
  "ErrorResult",
  "ExplainResult",
  "Interval",
  "IsoSlot",
  "LocalDate",
  "MeetingRequest",
  "NegotiationOk",
  "NegotiationRequest",
  "NegotiationResult",
  "Options",
  "ParticipantCheck",
  "PartyRules",
  "Reason",
  "ReasonCode",
  "ResolvedNegotiationRequest",
  "RuleRef",
  "UtcInstant",
  "ZoneId",
];

const INTERNAL_FOR_NOW = ["formatIssuePath", "IsoOffsetSchema", "parseNegotiationRequest"];

describe("public API surface (snapshot)", () => {
  it("exports exactly the public runtime values", () => {
    expect(Object.keys(api).sort()).toEqual([...PUBLIC_VALUES].sort());
  });

  it("keeps the internal helpers out of the entry point", () => {
    for (const name of INTERNAL_FOR_NOW) expect(Object.keys(api)).not.toContain(name);
  });

  it("exports exactly the public names, values and types together", () => {
    const entry = resolve(import.meta.dirname, "index.ts");
    const program = ts.createProgram([entry], {
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      target: ts.ScriptTarget.ES2023,
      strict: true,
      skipLibCheck: true,
      noEmit: true,
      types: [],
    });
    const checker = program.getTypeChecker();
    const source = program.getSourceFile(entry);
    expect(source).toBeDefined();
    const moduleSymbol = checker.getSymbolAtLocation(source as ts.SourceFile);
    expect(moduleSymbol).toBeDefined();
    const names = checker
      .getExportsOfModule(moduleSymbol as ts.Symbol)
      .map((symbol) => symbol.name)
      .sort();
    expect(names).toEqual([...PUBLIC_VALUES, ...PUBLIC_TYPES].sort());
  });
});

describe("NegotiationRequest is the input type (SPEC §3.2)", () => {
  it("lets callers omit defaulted fields", () => {
    const minimal: NegotiationRequest = {
      request: { date: "2025-01-06", start: "09:30", end: "10:30", timeZone: "America/New_York" },
      participants: [
        { partyId: "alice", timeZone: "America/New_York", weeklyRules: {} },
        { partyId: "bob", timeZone: "Europe/London", weeklyRules: {} },
      ],
      options: { now: "2025-01-03T12:00:00Z" },
    };
    expect(api.NegotiationRequestSchema.safeParse(minimal).success).toBe(true);
  });

  it("ResolvedNegotiationRequest has every default filled in", () => {
    const parsed = api.NegotiationRequestSchema.parse({
      request: { date: "2025-01-06", start: "09:30", end: "10:30", timeZone: "UTC" },
      participants: [
        { partyId: "a", timeZone: "UTC", weeklyRules: {} },
        { partyId: "b", timeZone: "UTC", weeklyRules: {} },
      ],
      options: { now: "2025-01-03T12:00:00Z" },
    });
    const resolved: ResolvedNegotiationRequest = parsed;
    const maxSuggestions: number = resolved.options.maxSuggestions;
    const blackouts: string[] = resolved.participants[0]?.blackouts ?? [];
    expect(maxSuggestions).toBe(3);
    expect(blackouts).toEqual([]);
  });
});
