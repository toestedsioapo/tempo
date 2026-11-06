import { existsSync, readFileSync } from "node:fs";
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

const BEGIN = "# BOOTSTRAP-BEGIN";
const END = "# BOOTSTRAP-END";

/**
 * A-94 shape rules for the bootstrap token path. Returns what is wrong, empty when the file is fine.
 * `released` is true once the release run has committed packages/cli/CHANGELOG.md (Guard B).
 */
export function bootstrapViolations(text: string, released: boolean): string[] {
  const out: string[] = [];
  const b = text.indexOf(BEGIN);
  const e = text.indexOf(END);
  const hasMarkers = b >= 0 || e >= 0;
  if (released && (hasMarkers || /NPM_BOOTSTRAP_TOKEN/.test(text) || /NODE_AUTH_TOKEN/.test(text))) {
    out.push("the bootstrap path is still present after the first release (remove it, M6 Task 6)");
  }
  if (/NPM_TOKEN|_authToken/.test(text)) out.push("NPM_TOKEN or _authToken present");
  if (hasMarkers && !(b >= 0 && e > b)) out.push("unbalanced BOOTSTRAP markers");
  const inside = b >= 0 && e > b ? text.slice(b, e) : "";
  const outside = b >= 0 && e > b ? text.slice(0, b) + text.slice(e) : text;
  if (/NODE_AUTH_TOKEN|NPM_BOOTSTRAP_TOKEN/.test(outside)) out.push("bootstrap token referenced outside the markers");
  for (const line of inside.split("\n")) {
    if (/NODE_AUTH_TOKEN/.test(line) && !/^\s+NODE_AUTH_TOKEN: \$\{\{ secrets\.NPM_BOOTSTRAP_TOKEN \}\}\s*$/.test(line)) {
      out.push(`unexpected NODE_AUTH_TOKEN line: ${line.trim()}`);
    }
    for (const m of line.matchAll(/secrets\.(\w+)/g)) {
      if (m[1] !== "NPM_BOOTSTRAP_TOKEN") out.push(`unexpected secret ${m[1] ?? ""}`);
    }
  }
  return out;
}

const released = existsSync(resolve(root, "packages/cli/CHANGELOG.md"));

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
      "pnpm changeset publish",
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
  });
});

describe("A-94: bootstrap token path", () => {
  it("release.yml has exactly the allowed shape", () => {
    expect(bootstrapViolations(release, released)).toEqual([]);
  });

  it("has an OIDC publish step outside the markers", () => {
    const b = release.indexOf(BEGIN);
    const e = release.indexOf(END);
    const outside = b >= 0 ? release.slice(0, b) + release.slice(e) : release;
    expect(outside).toMatch(/pnpm changeset publish/);
  });

  it.skipIf(released)("Guard A: fails when both packages exist on npm and the secret is still set", () => {
    const block = release.slice(release.indexOf(BEGIN), release.indexOf(END));
    expect(block).toContain("npm view @marvinliem/tempo-core version");
    expect(block).toContain("npm view @marvinliem/tempo version");
    expect(block).toMatch(/exit 1/);
  });

  describe("Guard B and the shape rules on synthetic text", () => {
    const good = `jobs:\n  publish:\n    steps:\n${BEGIN}\n      - run: x\n        env:\n          NODE_AUTH_TOKEN: \${{ secrets.NPM_BOOTSTRAP_TOKEN }}\n${END}\n`;
    it("passes before the release", () => expect(bootstrapViolations(good, false)).toEqual([]));
    it("fails once released while the block is present", () => {
      expect(bootstrapViolations(good, true)).toEqual([
        "the bootstrap path is still present after the first release (remove it, M6 Task 6)",
      ]);
    });
    it("passes once released and removed", () => expect(bootstrapViolations("jobs: {}\n", true)).toEqual([]));
    it("rejects the token outside the markers", () => {
      expect(bootstrapViolations(good + "      NODE_AUTH_TOKEN: x\n", false)).toContain("bootstrap token referenced outside the markers");
    });
    it("rejects any other secret or token line inside the block", () => {
      const other = good.replace("secrets.NPM_BOOTSTRAP_TOKEN", "secrets.OTHER");
      expect(bootstrapViolations(other, false).length).toBeGreaterThan(0);
    });
    it("rejects NPM_TOKEN and _authToken", () => {
      expect(bootstrapViolations(good + "NPM_TOKEN\n", false)).toContain("NPM_TOKEN or _authToken present");
    });
  });
});
