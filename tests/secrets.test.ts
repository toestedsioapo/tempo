import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");

export interface SecretHit {
  path: string;
  line: number;
  pattern: string;
}

interface Rule {
  name: string;
  re: RegExp;
  /** Only applied to paths matching this test. */
  only?: (path: string) => boolean;
}

const rules: Rule[] = [
  { name: "npm token", re: /\bnpm_[A-Za-z0-9]{36}\b/ },
  { name: "GitHub token", re: /\bghp_[A-Za-z0-9]{36}\b/ },
  { name: "GitHub fine-grained token", re: /\bgithub_pat_[A-Za-z0-9_]{22,}/ },
  { name: "npmrc auth token", re: /_authToken\s*=\s*[^\s|]+/, only: (p) => p.endsWith(".npmrc") },
  { name: "AWS access key id", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "PEM private key", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  {
    name: "workflow NODE_AUTH_TOKEN from secrets",
    // M6 Task 6: no token reference at all, not even the retired bootstrap secret.
    re: /NODE_AUTH_TOKEN\s*:\s*\$\{\{\s*secrets\./,
    only: (p) => /^\.github\/workflows\/.+\.ya?ml$/.test(p),
  },
];

export function findSecrets(files: Array<{ path: string; text: string }>): SecretHit[] {
  const hits: SecretHit[] = [];
  for (const { path, text } of files) {
    text.split(/\r?\n/).forEach((line, i) => {
      for (const rule of rules) {
        if (rule.only !== undefined && !rule.only(path)) continue;
        if (rule.re.test(line)) hits.push({ path, line: i + 1, pattern: rule.name });
      }
    });
  }
  return hits;
}

const alnum = (n: number): string => "x9".repeat(n).slice(0, n);

describe("findSecrets (synthetic samples built from fragments)", () => {
  const one = (path: string, text: string): string[] => findSecrets([{ path, text }]).map((h) => h.pattern);

  it("flags an npm token", () => expect(one("a.txt", `t=${"npm" + "_"}${alnum(36)}`)).toEqual(["npm token"]));
  it("flags a GitHub classic token", () => expect(one("a.txt", `${"gh" + "p_"}${alnum(36)}`)).toEqual(["GitHub token"]));
  it("flags a GitHub fine-grained token", () =>
    expect(one("a.txt", `${"github" + "_pat_"}${alnum(30)}`)).toEqual(["GitHub fine-grained token"]));
  it("flags _authToken with a value in an .npmrc", () =>
    expect(one(".npmrc", `//registry.npmjs.org/:${"_auth" + "Token"}=abc123`)).toEqual(["npmrc auth token"]));
  it("does not flag _authToken outside an .npmrc", () =>
    expect(one("notes.md", `${"_auth" + "Token"}=abc123`)).toEqual([]));
  it("flags an AWS access key id", () => expect(one("a.txt", `${"AK" + "IA"}${"A1".repeat(8)}`)).toEqual(["AWS access key id"]));
  it("flags a PEM private key header", () =>
    expect(one("k.txt", `${"-----BEGIN"} RSA ${"PRIVATE"} KEY-----`)).toEqual(["PEM private key"]));
  it("flags NODE_AUTH_TOKEN from secrets in a workflow", () =>
    expect(one(".github/workflows/release.yml", `        NODE_AUTH_TOKEN: \${{ ${"secrets"}.NPM }}`)).toEqual([
      "workflow NODE_AUTH_TOKEN from secrets",
    ]));
  it("flags the retired bootstrap secret too", () =>
    expect(one(".github/workflows/release.yml", `        NODE_AUTH_TOKEN: \${{ ${"secrets"}.NPM_BOOTSTRAP_TOKEN }}`)).toEqual([
      "workflow NODE_AUTH_TOKEN from secrets",
    ]));
  it("does not flag the two safe .npmrc lines", () =>
    expect(one(".npmrc", "engine-strict=true\nautoload-links=false")).toEqual([]));
  it("reports path and 1-based line", () =>
    expect(findSecrets([{ path: "a.txt", text: `ok\n${"AK" + "IA"}${"A1".repeat(8)}` }])).toEqual([
      { path: "a.txt", line: 2, pattern: "AWS access key id" },
    ]));
});

const BINARY = /\.(png|jpe?g|gif|ico|webp|pdf|zip|gz|tgz|woff2?|ttf|otf|eot|mp4|mov)$/i;

describe("tracked files hold no secrets", () => {
  const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" })
    .split("\0")
    .filter((p) => p !== "" && !BINARY.test(p));

  it("scans a non-trivial file set", () => expect(tracked.length).toBeGreaterThan(50));

  it("finds nothing in git ls-files", () => {
    const files = tracked.map((path) => ({ path, text: readFileSync(resolve(root, path), "utf8") }));
    expect(findSecrets(files)).toEqual([]);
  });

  it(".npmrc is exactly the two safe lines", () => {
    expect(readFileSync(resolve(root, ".npmrc"), "utf8").split(/\r?\n/).filter((l) => l !== "")).toEqual([
      "engine-strict=true",
      "autoload-links=false",
    ]);
  });

  it("no tracked file is named like a credential", () => {
    expect(tracked.filter((p) => /(^|\/)(\.env($|\.)|credentials|token)|\.pem$/i.test(p) && !/\.env\.example$/.test(p))).toEqual([]);
  });
});
