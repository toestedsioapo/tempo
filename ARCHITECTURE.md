# Tempo — ARCHITECTURE.md

> **Status:** Draft (planning only — no implementation code)
> **Mode:** Plan-mode deliverable. Review and approve before any scaffolding or code.

---

## 1. Package Layout (pnpm Workspace)

```
Tempo/
├── package.json               # root: name "tempo", private true, workspaces packages/*
├── pnpm-workspace.yaml        # packages: ['packages/*']
├── SPEC.md
├── ARCHITECTURE.md
├── TEST_PLAN.md
├── ROADMAP.md
├── README.md
├── SKILL.md                   # Claude Code skill for agents driving the CLI
├── packages/
│   ├── core/
│   │   ├── package.json       # name: @tempo/core, no CLI deps, Luxon + Zod
│   │   ├── src/
│   │   │   ├── index.ts       # public API entrypoint
│   │   │   ├── negotiate.ts   # pure core function
│   │   │   ├── slots.ts       # alternative-slot generation
│   │   │   ├── dts.ts         # DST / zone helpers
│   │   │   ├── schema.ts      # Zod schemas for request/response validation
│   │   │   └── types.ts       # public types (exported)
│   │   └── vitest.config.ts   # or root config
│   └── cli/
│       ├── package.json       # name: @tempo/cli, bin: "tempo", depends on @tempo/core
│       ├── src/
│       │   ├── index.ts       # CLI entrypoint (yargs/commander or minimal)
│       │   ├── check.ts       # `tempo check` command
│       │   ├── suggest.ts     # `tempo suggest` command
│       │   ├── explain.ts     # `tempo explain` command
│       │   ├── io.ts          # JSON parsing, stdout/stderr formatting
│       │   └── clock.ts       # system-time boundary (DateTime.now().toMillis())
│       └── vitest.config.ts
├── .github/
│   └── workflows/
│       └── ci.yml             # lint, test, build, release-with-provenance
└── .npmrc                     # provenance config, no secrets
```

### Structural Boundary

| Package | Responsibility | Deps | Allowed to |
|---------|---------------|------|------------|
| `@tempo/core` | Pure negotiation math, DST handling, validation | luxon, zod | Read `now` from input only; no `Date.now()`; no network; no TTY |
| `@tempo/cli` | Argument parsing, JSON IO, exit codes, system clock | @tempo/core, luxon | `DateTime.now()` at edge only; write to stdout/stderr |

---

## 2. Public API (Types Only)

### `@tempo/core` — `src/index.ts`

```ts
// Public types
export type { NegotiationRequest, NegotiationResult, PartyRules, IsoSlot, DayName }

// Core negotiation function (pure)
export function negotiate(
  request: NegotiationRequest
): NegotiationResult

// Zod schemas (also exported for JSON Schema generation)
export { NegotiationRequestSchema, NegotiationResultSchema, PartyRulesSchema }

// Generate JSON Schema from Zod (for SKILL.md / external consumers)
export function getRulesJsonSchema(): Record<string, unknown>
```

### `@tempo/cli` — `src/index.ts`

```ts
// CLI is not a library consumer target; it exports a main() for testing
export function main(argv: string[], nowOverride?: number): Promise<number>
// Returns exit code: 0 | 1 | 2 | 3
```

---

## 3. ADR 1 — Luxon vs Temporal

**Decision:** Use **Luxon** exclusively. Do not use Temporal/Stage-3 primitives.

**Rationale:**
- Temporal is Stage 3 (not yet standardized); Node LTS support is incomplete or requires polyfills.
- Luxon has mature IANA zone support, DST transition handling, and `invalid`/`ambiguous` reason reporting — exactly what Tempo's DST edge cases require.
- Constraint lock: project requirements specify Luxon.

**Consequences:**
- All `DateTime` construction goes through Luxon.
- Core never imports `Temporal` or `Polyfill`.
- If Temporal reaches Stage 4 and becomes Node LTS default, a future ADR can revisit.

---

## 4. ADR 2 — Zone-Abbreviation Policy

**Policy:** Ask, don't guess. IANA zone names (e.g. `America/New_York`, `Asia/Kolkata`) are accepted directly. 3-letter abbreviations (e.g. `IST`, `EST`, `GMT`) are **ambiguous** and must not be silently resolved.

**Runtime behavior:**
- If `timeZone` is a valid IANA zone → proceed normally.
- If `timeZone` matches an ambiguous abbreviation pattern (e.g. `IST`) → the CLI exits immediately with code **3** and logs structured JSON to stdout:

```json
{
  "error": "ambiguous_timezone",
  "abbreviation": "IST",
  "options": ["Asia/Kolkata", "Europe/Dublin", "America/New_York"]
}
```

- No interactive TTY prompt (CLI must be pipe/AI-driveable).
- Core does not resolve abbreviations; the CLI performs validation before calling core, or core returns a structured error that the CLI maps to exit code 3.

---

## 5. ADR 3 — How `"now"` Is Injected

**Rule:** `@tempo/core` never reads the system clock. `"now"` is a mandatory field in the request context.

**Type:** Strict Unix epoch millisecond timestamp (`number`) or ISO-8601 UTC string.

**Calling convention:**
- Bundled inside the request object passed to `negotiate()`.
- Core uses `now` to instantiate internal Luxon `DateTime` objects for DST/reference purposes.
- CLI boundary: `@tempo/cli` calls `DateTime.now().toMillis()` (or user-provided `--now` override flag) and injects it downward.
- Tests pass fixed `now` values for deterministic DST snapshots.

---

## 6. Data Flow (CLI → Core → Output)

```
User / AI
  │  JSON input (file or stdin)
  ▼
@tempo/cli
  ├─ Parse args (check | suggest | explain)
  ├─ Validate IANA zones (reject abbreviations → exit 3)
  ├─ Resolve now = DateTime.now().toMillis() (or --now flag)
  ├─ Call @tempo/core.negotiate(request)
  └─ Format output:
       ├─ decision=0 → print result JSON, exit 0
       ├─ decision=1 → print result JSON + slots, exit 1
       ├─ validation error → exit 2
       └─ ambiguous zone → exit 3
```

---

## 7. Stability Guarantees

- Exit codes are stable and documented (0/1/2/3).
- JSON output shape is versioned and stable across patch releases.
- No secrets in repo; `.npmrc` and CI use GitHub OIDC / provenance, no hardcoded tokens.
- `@tempo/core` is pure and testable without mocks.
