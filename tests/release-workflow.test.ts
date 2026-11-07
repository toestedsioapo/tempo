import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const read = (rel: string): string => readFileSync(resolve(root, rel), "utf8").replaceAll("\r\n", "\n");
const release = read(".github/workflows/release.yml");

/** The text of one top-level job (two-space indent) up to the next job or the end of the file. */
export function jobBlock(text: string, name: string): string {
  const m = new RegExp(`^  ${name}:\\n`, "m").exec(text);
  if (m === null) throw new Error(`no job ${name}`);
  const rest = text.slice(m.index + m[0].length);
  const next = /^ {2}[\w-]+:\n/m.exec(rest);
  return next === null ? rest : rest.slice(0, next.index);
}

/**
 * M6 Task 6 (A-94 superseded): release.yml publishes through npm trusted publishing (OIDC) only. Returns what is
 * wrong with `text`, empty when the file is fine. Applies from now on, whether or not a release exists.
 */
export function tokenViolations(text: string): string[] {
  const out: string[] = [];
  if (/BOOTSTRAP-(BEGIN|END)/.test(text)) out.push("BOOTSTRAP marker present");
  if (/NPM_BOOTSTRAP_TOKEN/.test(text)) out.push("NPM_BOOTSTRAP_TOKEN referenced");
  if (/NODE_AUTH_TOKEN/.test(text)) out.push("NODE_AUTH_TOKEN present");
  if (/NPM_TOKEN|_authToken/.test(text)) out.push("NPM_TOKEN or _authToken present");
  if (/\bsecrets\./.test(text)) out.push("a secret is referenced");
  return out;
}

describe("release.yml trigger, inputs and permissions", () => {
  it("is manual dispatch only", () => {
    const on = release.slice(release.indexOf("\non:"), release.indexOf("\npermissions:"));
    expect(on).toContain("workflow_dispatch:");
    for (const t of ["push:", "pull_request", "schedule:", "release:", "workflow_run"]) expect(on).not.toContain(t);
  });

  it("dry_run defaults to true and there is a confirm input", () => {
    expect(release).toMatch(/dry_run:\n(?: {8}.*\n)*? {8}type: boolean\n(?: {8}.*\n)*? {8}default: true\n/);
    expect(release).toMatch(/\n {6}confirm:\n/);
  });

  it("top-level permissions are read-only; only publish may write or mint an OIDC token", () => {
    const head = release.slice(0, release.indexOf("\njobs:"));
    expect(head).toMatch(/permissions:\n {2}contents: read\n/);
    expect(head).not.toContain("id-token");
    expect(jobBlock(release, "verify")).not.toMatch(/id-token|contents: write/);
    const publish = jobBlock(release, "publish");
    expect(publish).toContain("contents: write");
    expect(publish).toContain("id-token: write");
    expect(release.match(/id-token: write/g)).toHaveLength(1);
    expect(release.match(/contents: write/g)).toHaveLength(1);
  });

  it("publish needs verify, runs in the release environment, and only for a real run", () => {
    const publish = jobBlock(release, "publish");
    expect(publish).toMatch(/needs: verify\n/);
    expect(publish).toMatch(/environment: release\n/);
    expect(publish).toMatch(/if: \$\{\{ !inputs\.dry_run \}\}\n/);
  });

  it("sets provenance for npm", () => {
    expect(release).toMatch(/NPM_CONFIG_PROVENANCE: true/);
  });
});

describe("verify job", () => {
  const verify = jobBlock(release, "verify");
  const index = (needle: string): number => {
    const i = verify.indexOf(needle);
    expect(i, needle).toBeGreaterThanOrEqual(0);
    return i;
  };

  it("runs the repo gates on the committed state, then versions, then builds (A-95)", () => {
    const order = [
      "pnpm install --frozen-lockfile",
      "pnpm typecheck",
      "pnpm lint",
      "pnpm test",
      "pnpm check:names",
      "pnpm changeset version",
      "pnpm build",
    ].map(index);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // The frozen install must still work after the bump, so it runs once more.
    expect(verify.match(/pnpm install --frozen-lockfile/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("requires npm >= 11.5.1 (trusted publishing)", () => {
    expect(verify).toContain("npm --version");
    expect(verify).toContain("11.5.1");
  });

  it("refuses a private repository (Review Focus 1)", () => {
    expect(verify).toContain("gh api repos/${{ github.repository }} --jq .private");
    expect(verify).toMatch(/exit 1/);
    expect(verify).toMatch(/GH_TOKEN: \$\{\{ github\.token \}\}/);
  });

  it("smoke-installs both packed tarballs into an empty directory and checks the version (Review Focus 3)", () => {
    expect(verify.match(/pnpm pack/g)?.length).toBeGreaterThanOrEqual(2);
    expect(verify).toMatch(/npm install .*\.tgz/);
    expect(verify).toMatch(/tempo --version/);
    expect(verify).toMatch(/!= "\$VERSION"|!= "\$\{VERSION\}"|"\$VERSION" ]/);
  });

  it("dry-runs the publish of both packages when dry_run is set, and says what that does not prove (Review Focus 4)", () => {
    expect(verify).toMatch(/if: \$\{\{ inputs\.dry_run \}\}/);
    expect(verify).toContain("publish --dry-run");
    expect(verify).toContain("GITHUB_STEP_SUMMARY");
    expect(verify).toMatch(/does not prove/i);
    expect(verify).toMatch(/OIDC/);
  });

  it("exposes the version to the publish job", () => {
    expect(verify).toMatch(/outputs:\n {6}version: \$\{\{ steps\.\w+\.outputs\.version \}\}/);
  });
});

describe("publish job", () => {
  const publish = jobBlock(release, "publish");
  const at = (needle: string | RegExp): number => {
    const i = typeof needle === "string" ? publish.indexOf(needle) : publish.search(needle);
    expect(i, String(needle)).toBeGreaterThanOrEqual(0);
    return i;
  };

  it("only runs from main and only with the exact confirmation (Review Focus 5)", () => {
    expect(publish).toContain("refs/heads/main");
    expect(publish).toContain("publish v");
    expect(publish).toContain("inputs.confirm");
  });

  it("versions, builds, publishes, then pushes the release commit, tags and creates the release", () => {
    const order = [
      "pnpm changeset version",
      "pnpm build",
      "npm publish",
      /git commit .*chore\(release\)/,
      /git tag /,
      "gh release create",
    ].map(at);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(publish).toMatch(/git push origin HEAD:main/);
    expect(publish).toContain("## ${VERSION}");
  });

  it("reports which publish path ran", () => {
    expect(publish).toContain("GITHUB_STEP_SUMMARY");
    expect(publish).toContain("npm trusted publishing (OIDC)");
  });
});

describe("OIDC-only publish (M6 Task 6, A-94 superseded)", () => {
  const publish = jobBlock(release, "publish");

  it("holds no bootstrap path, no token and no secret", () => {
    expect(tokenViolations(release)).toEqual([]);
  });

  it("never publishes with changeset publish, and pnpm publish only as a dry run", () => {
    expect(release).not.toMatch(/changeset publish/);
    for (const line of release.split("\n")) {
      if (/pnpm publish/.test(line)) expect(line, line).toContain("--dry-run");
    }
  });

  it("packs both packages with pnpm pack (resolves workspace: ranges) before publishing", () => {
    expect(publish).toMatch(/\(cd packages\/core && pnpm pack --pack-destination "\$RUNNER_TEMP\/tarballs"\)/);
    expect(publish).toMatch(/\(cd packages\/cli && pnpm pack --pack-destination "\$RUNNER_TEMP\/tarballs"\)/);
    expect(publish.indexOf("pnpm pack")).toBeLessThan(publish.indexOf("npm publish"));
  });

  it("publishes each tarball with npm publish --provenance --access public, core before cli (pnpm 12 ignores provenance config)", () => {
    const cmds = publish.match(/^\s*npm publish .*$/gm) ?? [];
    expect(cmds.map((c) => c.trim())).toEqual(['npm publish "$tarball" --provenance --access public']);
    const calls = [...publish.matchAll(/^\s*publish_tarball (\S+) (\S+)$/gm)].map((m) => m.slice(1, 3));
    expect(calls).toEqual([
      ["@marvinliem/tempo-core", '"$RUNNER_TEMP/tarballs/marvinliem-tempo-core-${VERSION}.tgz"'],
      ["@marvinliem/tempo", '"$RUNNER_TEMP/tarballs/marvinliem-tempo-${VERSION}.tgz"'],
    ]);
  });

  it("skips a version already on the registry, so a re-run after a partial publish is safe (Review Focus 5)", () => {
    expect(publish).toMatch(/npm view "\$\{name\}@\$\{VERSION\}" version/);
  });

  describe("tokenViolations on synthetic text", () => {
    it("passes a token-free workflow", () => expect(tokenViolations("jobs: {}\n")).toEqual([]));
    it("rejects the bootstrap markers and token", () => {
      const text = "# BOOTSTRAP-BEGIN\n  NODE_AUTH_TOKEN: ${{ secrets.NPM_BOOTSTRAP_TOKEN }}\n# BOOTSTRAP-END\n";
      expect(tokenViolations(text)).toEqual([
        "BOOTSTRAP marker present",
        "NPM_BOOTSTRAP_TOKEN referenced",
        "NODE_AUTH_TOKEN present",
        "a secret is referenced",
      ]);
    });
    it("rejects NPM_TOKEN and _authToken", () => {
      expect(tokenViolations("NPM_TOKEN\n")).toContain("NPM_TOKEN or _authToken present");
      expect(tokenViolations("_authToken\n")).toContain("NPM_TOKEN or _authToken present");
    });
  });
});
