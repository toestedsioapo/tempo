# @marvinliem/tempo

The command-line interface for [Tempo](https://github.com/toestedsioapo/tempo): decide whether a meeting fits everyone's working hours across time zones, and get ranked counter-offers when it does not.

```bash
npm install -g @marvinliem/tempo

tempo check   request.json
tempo suggest request.json
tempo explain request.json --json
```

JSON in (a file or stdin), JSON out with `--json`, human-readable text otherwise.

Exit codes: `0` the computation succeeded (whatever the decision); `1` only with `--exit-code` and the decision is `counter_offer`; `2` input error; `3` ambiguous time zone abbreviation; `4` internal error.

Requires Node `>=24`. The input format and a worked demo are in the repository [README](https://github.com/toestedsioapo/tempo#readme); the behaviour is specified in [SPEC.md](https://github.com/toestedsioapo/tempo/blob/main/SPEC.md). The engine is published separately as [`@marvinliem/tempo-core`](https://www.npmjs.com/package/@marvinliem/tempo-core).

MIT.
