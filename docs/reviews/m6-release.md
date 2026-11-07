# M6 release review

## Rehearsal (Task 5 Step 2)

- **Dry run:** `release.yml`, `dry_run=true`, on `main` at `c1ac16a`, run **42229766359**: `verify` success, `publish` skipped (as designed for a dry run).
- **CI before it:** run 42228879116, all four jobs green (ubuntu and windows, Node 24 and 26).
- **First attempt (run 42227597568) failed**, and the failure was ours: `release.yml` ran `changeset version` before the repo tests, which flips the repo into its post-release state (the pending changeset is deleted, CHANGELOGs appear). Fixed by running the tests on the committed state first; the order is pinned in `tests/release-workflow.test.ts`. The same push fixed `release-metadata.test.ts` assuming `dist/` existed (CI tests before it builds).

What the green run showed (from the log):

| check | result |
|---|---|
| npm on the runner | 11.19.1 (>= 11.5.1) |
| repository private? | `false` (public) |
| `pnpm typecheck`, `lint`, `test`, `check:names` | pass; `@marvinliem/tempo-core` and `@marvinliem/tempo` both "available" |
| `changeset version` | both packages `0.1.0` |
| smoke install of both packed tarballs into an empty directory | `tempo --version -> 0.1.0` |
| `pnpm publish --dry-run` for core and cli | "Skip publishing ... (dry run)" for both `@0.1.0` |

The exact tarball file lists are asserted by `tests/release-metadata.test.ts` (core: `dist/index.js`, `schema/rules.schema.json`, `fixtures/fixtures.lock.json`, README, LICENSE, no `src/ test/ scripts/`; cli: `dist/bin.js` with a shebang, README, no `src/ test/`; the packed cli depends on core `0.1.0` exactly), not by the pnpm dry-run log, which does not print them.

**What this does not prove:** the npm trusted-publisher (OIDC) relationship, the bootstrap token, `--provenance` signing, the push of the release commit to `main`, the tag and the GitHub release. They run only in a real publish. One useful observation: pnpm 12's `publish` attempts OIDC itself (the log says `Skipped OIDC: ERR_PNPM_ID_TOKEN_GITHUB_WORKFLOW_INCORRECT_PERMISSIONS` in `verify`, which has no `id-token` permission by design), so the `publish` job's `id-token: write` is what enables it. The `${NODE_AUTH_TOKEN}` warning in the dry run is the unset token from `setup-node`'s `.npmrc` and is harmless there.

## Pre-publish checklist (Task 5 Step 3)

| item | state |
|---|---|
| repo public (`gh repo view` -> `isPrivate: false`) | done |
| `release` environment exists, owner is required reviewer | owner confirmed |
| `npm whoami` is the `@marvinliem` scope owner | owner confirmed (`marvinliem`) |
| `pnpm check:names` | clean in the dry run (both names available) |
| rehearsal green | done (run 42229766359) |
| `main` accepts a push from the Actions bot | `main` is **not protected** (`gh api .../branches/main/protection` -> 404 "Branch not protected"), so the `chore(release)` push is allowed |
| `NPM_BOOTSTRAP_TOKEN` on the `release` environment only, token not expired (1-day expiry) | **not done, by design**: the owner creates it right before the real dispatch (Owner setup 4) |
| trusted publishers | cannot exist yet (npm needs the packages first); configured after the release (Owner setup 5) |

**Gate #2 (irreversible).** No non-dry run is dispatched until the owner says "publish". Publishing makes `0.1.0` of both packages permanent on npm. The real run is `dry_run=false`, `confirm="publish v0.1.0"`, approved on the `release` environment.

## Task 6: remove the bootstrap path, publish through OIDC with provenance

**Why `0.1.0` has no provenance.** Run 42247256283 (the real `0.1.0` publish) ran `pnpm changeset publish`. The changesets publisher invokes `pnpm publish --json --access public --tag latest --no-git-checks` for a pnpm project: no `--provenance` flag. The log shows no provenance or transparency-log output, and the npm attestations API returns 404 for both `@0.1.0`. The "1 verified attestation" `npm audit signatures` reported belonged to a dependency, not to our packages. `NPM_CONFIG_PROVENANCE=true` and `publishConfig.provenance=true` were both set and made no difference, so pnpm 12 does not honor them on that path (inferred from the log and the API, not reproduced locally; A-96).

**Change.** `release.yml` no longer has the bootstrap block, Guard A, `NODE_AUTH_TOKEN` or any secret. It packs both packages with `pnpm pack` and publishes each tarball with `npm publish "$tarball" --provenance --access public`, core before cli, skipping a version already on npm. `tests/release-workflow.test.ts` pins that command, bans `changeset publish`, and bans any token or secret (Guard B now passes because the markers are gone).

**What is untested until the next release.** The OIDC-only path (trusted publisher for owner `toestedsioapo`, repo `tempo`, workflow `release.yml`, environment `release`, plus npm-signed provenance) has never run. The first real run is `0.1.1`. No rehearsal can prove it, and none is faked: a dry run does not exercise OIDC.
