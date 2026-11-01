# Tempo — DECISIONS.md

Decisions locked during planning review. Each entry records the decision, the reason, and a 'veto here' note. If you disagree with a decision, veto it by editing this file and noting the veto before implementation begins.

| # | Decision | Reason | Veto here |
|---|----------|--------|-----------|
| A1 | Remove @my-workspace/shared-ui dependency from root 'package.json' | Dependency does not exist; Tempo has no UI dependency in scope | |
| A1 | Remove 'workspaces' field from root 'package.json' | pnpm ignores root 'workspaces'; 'pnpm-workspace.yaml' is the source of truth | |
| A1 | Add 'packageManager': pnpm@9.12.3 | Pin package manager for reproducible installs | |
| A1 | Add 'engines.node': >=20.0.0 | Current Node LTS floor | |
| A1 | Add root scripts 'build', 'typecheck', 'lint', 'test' with --passWithNoTests | Consistent script surface; 'test' passes with no tests yet | |
| A2 | 'pnpm-workspace.yaml': 'packages: ['packages/*']' only | Remove unused 'apps/*' glob; match actual layout | |
| C5 | Weekly interval ? absolute UTC interval starting on its start day; merge adjacent/overlapping per party; request available iff fully contained in merged intervals; allow end '24:00'; reject 'start == end' as validation error | Clear interval algebra with DST-aware local?UTC expansion | |
| C6 | Blackout date interpreted in that party's own zone; blocks every availability interval that STARTS on that date | Overnight shift starting on blackout date blocked entirely | |
| C7 | If 'end <= start', request ends the next day (max 24 hours) | Simple overnight request rule | |
| C8 | 'now': ISO-8601 UTC string only; lower bound for candidate slots (+ optional 'minNoticeMinutes', default 0); request starting before now ? 'counter_offer' with reason; DST context never depends on 'now' | Single primitive type; 'now' only gates slot search | |
| C9 | Counter-offer search: 'searchHorizonDays' default 14, 15-minute step, same duration as request, up to 3 slots ranked by absolute distance from requested start (ties: earlier first) | Deterministic, bounded search | |
| C10 | Nonexistent AND ambiguous local time BOTH rejected with explicit reasons; detect via Luxon round-trip check | Luxon silently shifts gaps and picks first offset for ambiguous; round-trip check catches both | |
| C11 | Zone validation before Luxon; UTC and GMT allowed; common abbreviations and fixed-offset legacy IDs (EST, MST, HST) treated as ambiguous ? exit 3 with correct options table per abbreviation | Luxon accepts IST/EST/PST as valid; must not silently resolve | |
| C12 | Keep Luxon (do not adopt Temporal despite Stage 4 / Node 26) | Maturity, ecosystem, DST helpers, polyfill/runtime spread | |
| D13 | Replace 'partyA'/'partyB' with 'participants: PartyRules[]' (min 2); core never throws — returns '{ ok: false, error }'; CLI maps errors to exit codes | Support N participants; pure core with no exceptions | |
| D14 | Exit 0 whenever computation succeeds; '--exit-code' flag maps 'book'?0, 'counter_offer'?1; errors always 2 (input) or 3 (ambiguous zone) | Clean separation: computation success vs. decision outcome | |
| D15 | 'tempo explain' returns 'ExplainResult' with per-candidate per-participant checks '[{participant, ruleMatched, pass, reasonCode}]' with stable 'reasonCode' enum | Traceable, machine-readable explanation | |
| D16 | Rename 'dts.ts' ? 'dst.ts'; SKILL.md at repo root, tool-agnostic | Correct acronym; no Claude Code folder assumption | |
| E17 | Add brute-force minute-by-minute UTC oracle + differential tests; invariants: participant-swap symmetry, blackout monotonicity, slot re-submission returns book, determinism | Strong correctness guarantee | |
| E18 | Generators oversample DST transition days; zones: +5:30, +5:45, Australia/Sydney, Australia/Lord_Howe | Broad DST/offset coverage | |
| E19 | Branch coverage target + Stryker mutation-testing threshold; remove CORE-10/CLI-05 overlap; CI on Linux and Windows | Rigorous quality gates | |
| F20 | Split Milestone 2 into 2a (interval algebra, decision, oracle) and 2b (slot search, DST); npm-scope availability check as Milestone 1 gate; changesets for versioning; concrete checklist replaces 'reviewed by stakeholder' | Smaller milestones; scope verification; concrete DoD | |
| F21 | README demo: consistent dates/weekday/'now'; suggested slot inside both parties' hours; 'explain' shows per-candidate trace; Windows/PowerShell-safe file-or-stdin example | Accurate, runnable demo | |
