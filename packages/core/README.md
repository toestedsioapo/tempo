# @marvinliem/tempo-core

The pure engine behind [Tempo](https://github.com/toestedsioapo/tempo): given people's working hours, time zones and blackout dates, it decides whether a meeting request fits everyone and otherwise returns ranked, non-overlapping counter-offers with reasons.

- `evaluate`, `suggest`, `explain`: no clock, network or randomness. `now` is an input.
- Errors are values: a failed computation returns `{ ok: false, error }` and never throws.
- Zod schemas (`NegotiationRequestSchema`, `NegotiationResultSchema`, `ExplainResultSchema`) are the source of truth for the types.
- `@marvinliem/tempo-core/rules.schema.json` is the generated JSON Schema.
- `@marvinliem/tempo-core/fixtures/*` are the edge-case fixtures (append-only).

```bash
pnpm add @marvinliem/tempo-core
```

Requires Node `>=24`. Behaviour is specified in [SPEC.md](https://github.com/toestedsioapo/tempo/blob/main/SPEC.md); the repository [README](https://github.com/toestedsioapo/tempo#readme) has a worked demo. While on `0.x`, breaking changes bump the minor version and come with a CHANGELOG entry and a migration note.

MIT.
