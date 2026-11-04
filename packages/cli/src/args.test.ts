import { describe, expect, it } from "vitest";
import { helpText, parseCli } from "./args.js";
import { EXIT } from "./exit-codes.js";

const run = (command: "check" | "suggest" | "explain", over: Record<string, unknown> = {}) => ({
  kind: "run",
  command,
  file: undefined,
  json: false,
  exitCode: false,
  now: undefined,
  ...over,
});

describe("parseCli: running a command", () => {
  it.each([
    [["check", "f.json", "--json"], run("check", { file: "f.json", json: true })],
    [["suggest", "-", "--exit-code"], run("suggest", { exitCode: true })],
    [["explain"], run("explain")],
    [["--json", "explain", "f.json"], run("explain", { file: "f.json", json: true })],
    [["check", "--now", "2025-01-03T12:00:00Z"], run("check", { now: "2025-01-03T12:00:00Z" })],
    [["check", "--now=2025-01-03T12:00:00Z"], run("check", { now: "2025-01-03T12:00:00Z" })],
    [["check", "C:\\with space\\r\u00e9q.json"], run("check", { file: "C:\\with space\\r\u00e9q.json" })],
  ])("%j", (argv, expected) => {
    expect(parseCli(argv)).toEqual(expected);
  });

  it("does not validate the --now format (core does)", () => {
    expect(parseCli(["check", "--now", "garbage"])).toEqual(run("check", { now: "garbage" }));
  });
});

describe("parseCli: help and version", () => {
  it.each([
    [["--help"], undefined],
    [["-h"], undefined],
    [["check", "--help"], "check"],
    [["suggest", "-h"], "suggest"],
    [["explain", "--json", "-h"], "explain"],
  ])("%j", (argv, command) => {
    expect(parseCli(argv)).toEqual({ kind: "help", command });
  });

  it("--version", () => {
    expect(parseCli(["--version"])).toEqual({ kind: "version" });
  });
});

describe("parseCli: usage errors (CLI-16)", () => {
  it.each([
    [[], /Missing command/],
    [["frobnicate"], /frobnicate/],
    [["check", "--bogus"], /--bogus/],
    [["check", "-x"], /-x/],
    [["-v"], /-v/],
    [["check", "a.json", "b.json"], /Too many arguments/],
    [["check", "--now"], /--now/],
    [["check", "--json", "--json"], /more than once/],
    [["check", "--exit-code", "--exit-code"], /more than once/],
    [["check", "--now", "x", "--now", "y"], /more than once/],
    [["check", "--help", "--help"], /more than once/],
  ])("%j", (argv, message) => {
    const r = parseCli(argv);
    expect(r.kind).toBe("usage-error");
    expect(r.kind === "usage-error" && r.message).toMatch(message);
  });

  it("remembers that --json was given, so the error can honour it", () => {
    expect(parseCli(["check", "--bogus", "--json"])).toMatchObject({ kind: "usage-error", json: true });
    expect(parseCli(["check", "--bogus"])).toMatchObject({ kind: "usage-error", json: false });
  });
});

describe("helpText", () => {
  it("is ASCII-only", () => {
    for (const c of [undefined, "check", "suggest", "explain"] as const) {
      expect(helpText(c)).toMatch(/^[\x00-\x7f]*$/);
    }
  });

  it("documents every command, flag and exit code", () => {
    const text = helpText();
    for (const word of ["check", "suggest", "explain", "--json", "--exit-code", "--now", "--help", "-h", "--version"]) {
      expect(text, word).toContain(word);
    }
    for (const code of Object.values(EXIT)) expect(text, `exit ${code}`).toMatch(new RegExp(`^\\s*${code}\\s`, "m"));
  });

  it("per-command help names the command and still lists the exit codes", () => {
    expect(helpText("explain")).toContain("tempo explain");
    expect(helpText("explain")).toMatch(/^\s*4\s/m);
  });
});
