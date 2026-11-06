import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const text = readFileSync(resolve(root, ".github/workflows/verify-release.yml"), "utf8").replaceAll("\r\n", "\n");

describe("verify-release.yml", () => {
  it("is manual dispatch only, with a version input defaulting to 0.1.0", () => {
    const on = text.slice(text.indexOf("\non:"), text.indexOf("\npermissions:"));
    expect(on).toContain("workflow_dispatch:");
    for (const t of ["push:", "pull_request", "schedule:", "workflow_run"]) expect(on).not.toContain(t);
    expect(on).toMatch(/version:\n(?: {8}.*\n)*? {8}default: "0\.1\.0"\n/);
  });

  it("runs on ubuntu and windows with Node 24", () => {
    expect(text).toMatch(/os: \[ubuntu-latest, windows-latest\]/);
    expect(text).toMatch(/node-version: 24/);
  });

  it("holds no secrets, no token and no write permission", () => {
    expect(text).not.toMatch(/secrets\.|NODE_AUTH_TOKEN|NPM_TOKEN|_authToken|contents: write|id-token/);
    expect(text).toMatch(/permissions:\n {2}contents: read\n/);
  });

  it("checks both packages exist at the version on the registry", () => {
    expect(text).toContain("npm view @marvinliem/tempo-core@${VERSION} version");
    expect(text).toContain("npm view @marvinliem/tempo@${VERSION} version");
  });

  it("runs npx on the published CLI from an empty directory", () => {
    expect(text).toContain("npx --yes @marvinliem/tempo@${VERSION} --version");
  });

  it("runs the README demo against the installed package and compares it with the repo's expected output", () => {
    expect(text).toContain("npm install @marvinliem/tempo@${VERSION}");
    expect(text).toMatch(/tempo explain demo\.json --json/);
    expect(text).toContain("examples/demo.json");
    expect(text).toContain("examples/demo.explain.json");
  });

  it("verifies registry signatures and provenance attestations", () => {
    expect(text).toContain("npm audit signatures");
  });
});
