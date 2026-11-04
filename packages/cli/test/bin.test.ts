import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { example } from "./fixtures.js";

// Spawned-process tests run the real entry point through tsx with cwd = packages/cli (A-79):
// no build needed, and tsx maps @marvinliem/tempo-core to core's source via the tsconfig `paths`.
const CLI_DIR = resolve(import.meta.dirname, "..");

interface Result {
  code: number | null;
  stdout: Buffer;
  stderr: string;
}

function tempo(args: string[], opts: { stdin?: Buffer | "ignore" | "empty" } = {}): Promise<Result> {
  const stdin = opts.stdin ?? "ignore";
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, ["--import", "tsx", "src/bin.ts", ...args], {
      cwd: CLI_DIR,
      stdio: [stdin === "ignore" ? "ignore" : "pipe", "pipe", "pipe"],
    });
    const out: Buffer[] = [];
    let err = "";
    child.stdout.on("data", (c: Buffer) => out.push(c));
    child.stderr.on("data", (c: Buffer) => (err += c.toString("utf8")));
    child.on("error", fail);
    child.on("close", (code) => done({ code, stdout: Buffer.concat(out), stderr: err }));
    if (stdin !== "ignore") child.stdin?.end(stdin === "empty" ? undefined : stdin);
  });
}

const text = (r: Result) => r.stdout.toString("utf8");
const enc = (s: string) => Buffer.from(s, "utf8");
const utf16le = (s: string) => Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(s, "utf16le")]);

let dir: string;
let spaced: string;
const ex01 = JSON.stringify(example(1).input, null, 2);

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "tempo cli ünï "));
  spaced = join(dir, "with space ünï.json");
  writeFileSync(spaced, ex01);
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("CLI-18: the real binary", () => {
  it("reads a path with spaces and non-ASCII characters, absolute and relative", async () => {
    const abs = await tempo(["check", "--json", spaced]);
    const rel = await tempo(["check", "--json", relative(CLI_DIR, spaced)]);
    expect(abs.code).toBe(0);
    expect(JSON.parse(text(abs))).toEqual(example(1).expected);
    expect(text(rel)).toBe(text(abs));
    expect(abs.stderr).toBe("");
  });

  it("CRLF, UTF-8 BOM and UTF-16LE BOM files give identical output", async () => {
    const files: [string, Buffer][] = [
      ["crlf.json", enc(ex01.replace(/\n/g, "\r\n"))],
      ["bom8.json", Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), enc(ex01)])],
      ["utf16.json", utf16le(ex01)],
    ];
    const base = text(await tempo(["check", "--json", spaced]));
    for (const [name, bytes] of files) {
      const p = join(dir, name);
      writeFileSync(p, bytes);
      const r = await tempo(["check", "--json", p]);
      expect(r.code, name).toBe(0);
      expect(text(r), name).toBe(base);
    }
  });

  it("stdin (piped) and - give the same output as the file", async () => {
    const base = text(await tempo(["check", "--json", spaced]));
    const piped = await tempo(["check", "--json"], { stdin: enc(ex01) });
    const dash = await tempo(["check", "--json", "-"], { stdin: enc(ex01) });
    expect([piped.code, dash.code]).toEqual([0, 0]);
    expect(text(piped)).toBe(base);
    expect(text(dash)).toBe(base);
  });

  it("CLI-13: with no file and no input it exits 2 instead of hanging", async () => {
    const closed = await tempo(["check", "--json"]);
    expect(closed.code).toBe(2);
    expect(JSON.parse(text(closed)).error.code).toBe("INVALID_INPUT");
    const empty = await tempo(["check", "--json"], { stdin: "empty" });
    expect(empty.code).toBe(2);
    expect(JSON.parse(text(empty)).error.message).toContain("Input is empty.");
  });

  it.each([
    ["EX-01", 1, [], 0],
    ["EX-17 with --exit-code", 17, ["--exit-code"], 1],
    ["EX-12", 12, [], 2],
    ["EX-23", 23, [], 3],
  ] as const)("exit code through a real process: %s", async (_name, n, extra, want) => {
    const p = join(dir, `ex-${n}.json`);
    writeFileSync(p, JSON.stringify(example(n).input));
    const r = await tempo(["check", "--json", ...extra, p]);
    expect(r.code).toBe(want);
  });

  it("human output and errors reach the right streams", async () => {
    const ok = await tempo(["check", spaced]);
    expect(ok.code).toBe(0);
    expect(text(ok)).toMatch(/^Decision: book\n/);
    const bad = await tempo(["check", join(dir, "missing.json")]);
    expect(bad.code).toBe(2);
    expect(text(bad)).toBe("");
    expect(bad.stderr).toMatch(/^tempo: INVALID_INPUT: /);
    expect(bad.stderr).not.toMatch(/\bat \w/);
  });

  it("a directory instead of a file is INVALID_INPUT (EISDIR)", async () => {
    const r = await tempo(["check", "--json", dir]);
    expect(r.code).toBe(2);
    expect(JSON.parse(text(r)).error.code).toBe("INVALID_INPUT");
  });

  it("closed stdout: no stack trace, exit status intact", async () => {
    const fx = example(22);
    const input = structuredClone(fx.input) as { participants: { partyId: string }[]; options: Record<string, unknown> };
    const [first] = input.participants;
    if (first === undefined) throw new Error("fixture has no participants");
    for (let i = 0; input.participants.length < 50; i++) {
      input.participants.push({ ...structuredClone(first), partyId: `extra-${i}` });
    }
    input.options.maxSuggestions = 10;
    const p = join(dir, "big.json");
    writeFileSync(p, JSON.stringify(input));

    const result = await new Promise<{ code: number | null; stderr: string; seen: number }>((done, fail) => {
      const child = spawn(process.execPath, ["--import", "tsx", "src/bin.ts", "explain", "--json", p], {
        cwd: CLI_DIR,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stderr = "";
      let seen = 0;
      child.stderr.on("data", (c: Buffer) => (stderr += c.toString("utf8")));
      child.stdout.once("data", (c: Buffer) => {
        seen = c.length;
        child.stdout.destroy(); // the consumer goes away after the first chunk, like `| head -1`
      });
      child.on("error", fail);
      child.on("close", (code) => done({ code, stderr, seen }));
    });
    expect(result.seen).toBeGreaterThan(0);
    expect(result.code).toBe(0);
    expect(result.stderr).not.toMatch(/EPIPE|ERR_STREAM|\bat \w/);
  });

  it("output has no BOM, and --version prints the package version", async () => {
    const r = await tempo(["check", "--json", spaced]);
    expect([...r.stdout.subarray(0, 3)]).not.toEqual([0xef, 0xbb, 0xbf]);
    const v = await tempo(["--version"]);
    const pkg = JSON.parse(readFileSync(join(CLI_DIR, "package.json"), "utf8")) as { version: string };
    expect(v.code).toBe(0);
    expect(text(v)).toBe(`${pkg.version}\n`);
  });

  it("--help lists the exit codes", async () => {
    const r = await tempo(["--help"]);
    expect(r.code).toBe(0);
    expect(text(r)).toContain("Exit codes:");
  });
});
