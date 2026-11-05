import { afterEach, describe, expect, it, vi } from "vitest";
import { evaluate, suggest } from "@marvinliem/tempo-core";
import type { NegotiationRequest } from "@marvinliem/tempo-core";
import { helpText } from "./args.js";
import { main } from "./main.js";
import { FAKE_NOW, fakeEnv, type FakeEnv } from "../test/env.js";
import { example, type ExampleFixture } from "../test/fixtures.js";

const PATH = "req.json";
const enc = (s: string) => new TextEncoder().encode(s);
type EnvOver = Parameters<typeof fakeEnv>[0];

async function run(argv: string[], fx: ExampleFixture, over: EnvOver = {}) {
  const env = fakeEnv({ files: { [PATH]: JSON.stringify(fx.input) }, ...over });
  const code = await main([...argv, PATH], env);
  return { code, out: env.out.join(""), err: env.err.join(""), env };
}

async function runRaw(argv: string[], over: EnvOver = {}) {
  const env = fakeEnv(over);
  const code = await main(argv, env);
  return { code, out: env.out.join(""), err: env.err.join(""), env };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = (s: string) => JSON.parse(s) as Record<string, any>;

const withoutNow = (fx: ExampleFixture): ExampleFixture => {
  const input = structuredClone(fx.input) as { options?: Record<string, unknown> };
  delete input.options?.now;
  return { ...fx, input: input as Record<string, unknown> };
};

describe("CLI-01 .. CLI-05: decisions and exit codes", () => {
  it("CLI-01: check on EX-01 prints core's result", async () => {
    const fx = example(1);
    const r = await run(["check", "--json"], fx);
    expect(r.code).toBe(0);
    expect(json(r.out)).toEqual(fx.expected);
    expect(r.err).toBe("");
    expect(r.out.endsWith("\n")).toBe(true);
  });

  it("CLI-02/03: --exit-code turns counter_offer into 1 and leaves book at 0", async () => {
    const ex17 = example(17);
    expect((await run(["check", "--json"], ex17)).code).toBe(0);
    expect((await run(["check", "--json", "--exit-code"], ex17)).code).toBe(1);
    expect((await run(["check", "--json", "--exit-code"], example(1))).code).toBe(0);
  });

  it("CLI-04: suggest returns the ranked slots", async () => {
    const fx = example(17);
    const r = await run(["suggest", "--json"], fx);
    expect(r.code).toBe(0);
    expect(json(r.out)).toEqual(suggest(fx.input as unknown as NegotiationRequest));
    expect(json(r.out).slots.length).toBeGreaterThan(0);
    expect((await run(["suggest", "--json", "--exit-code"], fx)).code).toBe(1);
  });

  it("CLI-05: explain prints the trace", async () => {
    const fx = example(22);
    const r = await run(["explain", "--json"], fx);
    expect(r.code).toBe(0);
    expect(json(r.out)).toEqual(fx.expected);
    expect((await run(["explain", "--json", "--exit-code"], fx)).code).toBe(1);
  });

  it("--exit-code changes only the status, never the output", async () => {
    const fx = example(17);
    expect((await run(["check", "--json"], fx)).out).toBe((await run(["check", "--json", "--exit-code"], fx)).out);
  });
});

describe("CLI-06 .. CLI-09: input errors", () => {
  it("CLI-06: malformed JSON (file) is INVALID_INPUT, exit 2", async () => {
    const r = await runRaw(["check", "--json", PATH], { files: { [PATH]: "{" } });
    expect(r.code).toBe(2);
    expect(r.err).toBe("");
    const body = json(r.out);
    expect(body.error.code).toBe("INVALID_INPUT");
    expect(body.error.details.source).toBe("file");
    expect(body.error.message).toContain(PATH);
  });

  it("CLI-06: without --json the error is one stderr line and stdout stays empty", async () => {
    const r = await runRaw(["check", PATH], { files: { [PATH]: "{" } });
    expect(r.code).toBe(2);
    expect(r.out).toBe("");
    expect(r.err.endsWith("\n")).toBe(true);
    expect(r.err.trimEnd().split("\n")).toHaveLength(1);
    expect(r.err).toMatch(/^tempo: INVALID_INPUT: /);
  });

  it.each([["ENOENT"], ["EISDIR"], ["EACCES"]])("CLI-06: unreadable path (%s) names the path", async (code) => {
    const env = fakeEnv({
      readFile: async () => {
        throw Object.assign(new Error(`${code}: boom`), { code });
      },
    });
    const exit = await main(["check", "--json", "some dir/f.json"], env);
    expect(exit).toBe(2);
    const body = json(env.out.join(""));
    expect(body.error.code).toBe("INVALID_INPUT");
    expect(body.error.message).toContain("some dir/f.json");
    expect(body.error.details).toMatchObject({ source: "file", path: "some dir/f.json", code });
  });

  it("CLI-06: a read error without a code still names the path", async () => {
    const env = fakeEnv({
      readFile: async () => {
        throw "plain string";
      },
    });
    expect(await main(["check", "--json", "f.json"], env)).toBe(2);
    expect(json(env.out.join("")).error.message).toContain("f.json");
  });

  it("CLI-06: invalid UTF-8 is INVALID_INPUT, not mojibake", async () => {
    const r = await runRaw(["check", "--json", PATH], { files: { [PATH]: Uint8Array.from([0x7b, 0xff, 0x7d]) } });
    expect(r.code).toBe(2);
    expect(json(r.out).error.message).toContain("Input is not valid text");
  });

  it("CLI-07: {} and a request without participants are core's INVALID_INPUT", async () => {
    const empty = await runRaw(["check", "--json", PATH], { files: { [PATH]: "{}" } });
    expect(empty.code).toBe(2);
    expect(json(empty.out).error.code).toBe("INVALID_INPUT");
    const fx = example(1);
    const input = structuredClone(fx.input);
    delete input.participants;
    const r = await run(["check", "--json"], { ...fx, input });
    expect(r.code).toBe(2);
    expect(json(r.out).error.code).toBe("INVALID_INPUT");
  });

  it("CLI-08: an ambiguous abbreviation is exit 3 with candidates", async () => {
    const r = await run(["check", "--json"], example(23));
    expect(r.code).toBe(3);
    const body = json(r.out);
    expect(body.error.code).toBe("AMBIGUOUS_ZONE");
    expect(body.error.details.options.length).toBeGreaterThan(0);
  });

  it("CLI-09: DST gap and overlap are exit 2", async () => {
    const gap = await run(["check", "--json"], example(12));
    const overlap = await run(["check", "--json"], example(13));
    expect([gap.code, overlap.code]).toEqual([2, 2]);
    expect(json(gap.out).error.code).toBe("DST_NONEXISTENT_LOCAL_TIME");
    expect(json(overlap.out).error.code).toBe("DST_AMBIGUOUS_LOCAL_TIME");
  });

  it.each([["null"], ["[]"], ["42"], ['"x"'], ["true"]])(
    "non-object JSON %s is INVALID_INPUT, with and without --now",
    async (text) => {
      for (const extra of [[], ["--now", "2025-01-03T12:00:00Z"]]) {
        const r = await runRaw(["check", "--json", ...extra, PATH], { files: { [PATH]: text } });
        expect(r.code).toBe(2);
        expect(json(r.out).error.code).toBe("INVALID_INPUT");
        expect(r.err).toBe("");
      }
    },
  );
});

describe("CLI-10: now precedence through main", () => {
  it("the clock is used when neither the flag nor the file gives a now", async () => {
    const fx = withoutNow(example(1));
    const r = await run(["check", "--json"], fx);
    const expected = evaluate({ ...fx.input, options: { now: FAKE_NOW } } as unknown as NegotiationRequest);
    expect(json(r.out)).toEqual(expected);
  });

  it("--now overrides the file", async () => {
    const fx = example(19);
    const flag = "2020-01-01T00:00:00Z";
    const r = await run(["check", "--json", "--now", flag], fx);
    const expected = evaluate({
      ...fx.input,
      options: { ...(fx.input.options as object), now: flag },
    } as unknown as NegotiationRequest);
    expect(json(r.out)).toEqual(expected);
    expect(json(r.out)).not.toEqual(fx.expected);
  });

  it.each([["2025-01-03T12:00:00.5Z"], ["2025-01-03T12:00:00+02:00"], ["2025-01-03"], ["2025-01-03T12:00:00z"]])(
    "invalid --now %s is exit 2 INVALID_INPUT with nothing on stderr",
    async (now) => {
      const r = await run(["check", "--json", "--now", now], example(1));
      expect(r.code).toBe(2);
      expect(json(r.out).error.code).toBe("INVALID_INPUT");
      expect(r.err).toBe("");
    },
  );

  it("--now given twice, or with no value, is a usage error naming the flag", async () => {
    const twice = await runRaw(["check", "--json", "--now", "a", "--now", "b"]);
    const none = await runRaw(["check", "--json", "--now"]);
    expect([twice.code, none.code]).toEqual([2, 2]);
    expect(json(none.out).error.message).toContain("--now");
    expect(json(twice.out).error.message).toContain("--now");
  });
});

describe("CLI-11: input routes", () => {
  it("a path, stdin, and - give identical output", async () => {
    const bytes = JSON.stringify(example(1).input);
    const viaFile = await runRaw(["check", "--json", PATH], { files: { [PATH]: bytes } });
    const viaStdin = await runRaw(["check", "--json"], { stdin: bytes });
    const viaDash = await runRaw(["check", "--json", "-"], { stdin: bytes });
    expect(viaStdin.out).toBe(viaFile.out);
    expect(viaDash.out).toBe(viaFile.out);
    expect(viaFile.code).toBe(0);
  });

  it("two files, or - plus a file, is a usage error", async () => {
    expect((await runRaw(["check", "a.json", "b.json"])).code).toBe(2);
    expect((await runRaw(["check", "-", "x"])).code).toBe(2);
  });
});

describe("CLI-12: encodings and text through main", () => {
  it("CRLF, UTF-8 BOM and UTF-16LE BOM inputs match the plain output", async () => {
    const plain = JSON.stringify(example(1).input, null, 2);
    const base = await runRaw(["check", "--json", PATH], { files: { [PATH]: plain } });
    const crlf = await runRaw(["check", "--json", PATH], { files: { [PATH]: plain.replace(/\n/g, "\r\n") } });
    const bom = await runRaw(["check", "--json", PATH], {
      files: { [PATH]: Uint8Array.from([0xef, 0xbb, 0xbf, ...enc(plain)]) },
    });
    const u16 = new Uint8Array(2 + plain.length * 2);
    u16.set([0xff, 0xfe]);
    for (let i = 0; i < plain.length; i++) {
      const c = plain.charCodeAt(i);
      u16[2 + i * 2] = c & 0xff;
      u16[3 + i * 2] = c >> 8;
    }
    const wide = await runRaw(["check", "--json", PATH], { files: { [PATH]: u16 } });
    for (const r of [crlf, bom, wide]) expect(r.out).toBe(base.out);
    expect(base.out.charCodeAt(0)).not.toBe(0xfeff);
  });

  it("a non-ASCII partyId round-trips unchanged", async () => {
    const input = JSON.stringify(example(22).input).replaceAll("carol", "Zoë-Ünï");
    const r = await runRaw(["explain", "--json", PATH], { files: { [PATH]: input } });
    expect(r.out).toContain("Zoë-Ünï");
  });
});

describe("CLI-13: no prompts, no waiting on a TTY", () => {
  it("a TTY with no file fails at once without reading stdin", async () => {
    const readStdin = vi.fn(async () => enc("{}"));
    const r = await runRaw(["check", "--json"], { stdinIsTTY: true, readStdin });
    expect(r.code).toBe(2);
    expect(readStdin).not.toHaveBeenCalled();
    const body = json(r.out);
    expect(body.error.code).toBe("INVALID_INPUT");
    expect(body.error.details.source).toBe("stdin");
  });

  it("empty stdin is reported as empty", async () => {
    const r = await runRaw(["check", "--json"], { stdin: "" });
    expect(r.code).toBe(2);
    expect(json(r.out).error.message).toContain("Input is empty.");
  });

  it("a TTY does not matter when a file is given", async () => {
    const r = await run(["check", "--json"], example(1), { stdinIsTTY: true });
    expect(r.code).toBe(0);
  });

  it("a failing stdin read is INVALID_INPUT with source stdin", async () => {
    const r = await runRaw(["check", "--json"], {
      readStdin: async () => {
        throw new Error("read failed");
      },
    });
    expect(r.code).toBe(2);
    expect(json(r.out).error.details.source).toBe("stdin");
  });
});

describe("CLI-15 / CLI-16: help, version, usage", () => {
  it("--help prints helpText and exits 0", async () => {
    const r = await runRaw(["--help"]);
    expect([r.code, r.out, r.err]).toEqual([0, helpText(), ""]);
    expect((await runRaw(["check", "-h"])).out).toBe(helpText("check"));
  });

  it("--version prints the version and exits 0", async () => {
    const r = await runRaw(["--version"], { version: "9.8.7" });
    expect([r.code, r.out, r.err]).toEqual([0, "9.8.7\n", ""]);
  });

  it("no command prints usage on stderr, stdout empty, exit 2", async () => {
    const r = await runRaw([]);
    expect(r.code).toBe(2);
    expect(r.out).toBe("");
    expect(r.err).toContain(helpText());
  });

  it("unknown command / flag: exit 2; with --json, a JSON document and nothing on stderr", async () => {
    for (const argv of [["frobnicate"], ["check", "--bogus"]]) {
      const plain = await runRaw(argv);
      expect(plain.code).toBe(2);
      expect(plain.out).toBe("");
      expect(plain.err).toMatch(/^tempo: INVALID_INPUT: /);
      const asJson = await runRaw([...argv, "--json"]);
      expect(asJson.code).toBe(2);
      expect(asJson.err).toBe("");
      expect(json(asJson.out).error).toMatchObject({ code: "INVALID_INPUT", details: { source: "argv" } });
    }
  });
});

describe("CLI-17: unexpected failures", () => {
  afterEach(() => {
    vi.doUnmock("@marvinliem/tempo-core");
    vi.resetModules();
  });

  async function mainWithBrokenCore() {
    vi.resetModules();
    vi.doMock("@marvinliem/tempo-core", async (orig) => ({
      ...(await orig<typeof import("@marvinliem/tempo-core")>()),
      evaluate: () => {
        throw new Error("secret stack detail");
      },
    }));
    return (await import("./main.js")).main;
  }

  it("a throwing core is INTERNAL_ERROR, exit 4, no stack trace anywhere", async () => {
    const brokenMain = await mainWithBrokenCore();
    const env = fakeEnv({ files: { [PATH]: JSON.stringify(example(1).input) } });
    expect(await brokenMain(["check", "--json", PATH], env)).toBe(4);
    const out = env.out.join("");
    expect(json(out).error.code).toBe("INTERNAL_ERROR");
    expect(env.err).toEqual([]);
    expect(out).not.toContain("secret");
    expect(out).not.toMatch(/\bat \w/);
  });

  it("without --json the INTERNAL_ERROR goes to stderr as one line", async () => {
    const brokenMain = await mainWithBrokenCore();
    const env = fakeEnv({ files: { [PATH]: JSON.stringify(example(1).input) } });
    expect(await brokenMain(["check", PATH], env)).toBe(4);
    expect(env.out).toEqual([]);
    expect(env.err.join("")).toMatch(/^tempo: INTERNAL_ERROR: .*\n$/);
    expect(env.err.join("")).not.toContain("secret");
  });

  it("an env.write that throws is INTERNAL_ERROR, exit 4", async () => {
    let calls = 0;
    const env: FakeEnv = fakeEnv({
      files: { [PATH]: JSON.stringify(example(1).input) },
      write: (s: string) => {
        if (calls++ === 0) throw new Error("EIO");
        env.out.push(s);
      },
    });
    expect(await main(["check", "--json", PATH], env)).toBe(4);
    expect(json(env.out.join("")).error.code).toBe("INTERNAL_ERROR");
  });

  it("main resolves to 4 even when every write throws", async () => {
    const env = fakeEnv({
      files: { [PATH]: JSON.stringify(example(1).input) },
      write: () => {
        throw new Error("EIO");
      },
      writeErr: () => {
        throw new Error("EIO");
      },
    });
    await expect(main(["check", "--json", PATH], env)).resolves.toBe(4);
  });
});

describe("review additions (M4 Task 1)", () => {
  it("two files fail because of the argument count, not because the files are missing", async () => {
    const files = { "a.json": "{}", "b.json": "{}", x: "{}" };
    const two = await runRaw(["check", "--json", "a.json", "b.json"], { files });
    const dash = await runRaw(["check", "--json", "-", "x"], { files, stdin: "{}" });
    for (const r of [two, dash]) {
      expect(r.code).toBe(2);
      expect(json(r.out).error.message).toMatch(/Too many arguments/);
    }
  });

  it("--json alone, and --now before another flag, are JSON usage errors", async () => {
    const bare = await runRaw(["--json"]);
    expect(bare.code).toBe(2);
    expect(json(bare.out).error.message).toContain("Missing command");
    expect(bare.err).toBe("");
    const dangling = await runRaw(["check", "--now", "--json"]);
    expect(dangling.code).toBe(2);
    expect(json(dangling.out).error.message).toContain("--now");
  });

  it("a usage error with a multi-line message is one line on stderr", async () => {
    const r = await runRaw(["check", "--now", "--bogus"]);
    expect(r.code).toBe(2);
    expect(r.out).toBe("");
    expect(r.err.trimEnd().split("\n")).toHaveLength(1);
  });

  it("a read error carries its reason (non-Error and null rejections)", async () => {
    const thrown = fakeEnv({
      readFile: async () => {
        throw "plain string";
      },
    });
    expect(await main(["check", "--json", "f.json"], thrown)).toBe(2);
    expect(json(thrown.out.join("")).error.message).toContain("plain string");
    const nul = fakeEnv({
      readFile: async () => {
        throw null;
      },
    });
    expect(await main(["check", "--json", "f.json"], nul)).toBe(2);
    expect(json(nul.out.join("")).error.code).toBe("INVALID_INPUT");
  });

  it("--now with no options object in the file overrides the clock", async () => {
    const input = structuredClone(example(1).input) as Record<string, unknown>;
    delete input["options"];
    const r = await runRaw(["check", "--json", "--now", "2025-01-03T12:00:00Z", PATH], {
      files: { [PATH]: JSON.stringify(input) },
    });
    const expected = evaluate({ ...(input as unknown as NegotiationRequest), options: { now: "2025-01-03T12:00:00Z" } });
    expect(r.code).toBe(0);
    expect(json(r.out)).toEqual(JSON.parse(JSON.stringify(expected)));
  });

  it("an empty file, and empty stdin with --now, are INVALID_INPUT (exit 2)", async () => {
    const file = await runRaw(["check", "--json", PATH], { files: { [PATH]: "" } });
    expect(file.code).toBe(2);
    expect(json(file.out).error.message).toContain("Input is empty.");
    const stdin = await runRaw(["check", "--json", "--now", "2025-01-03T12:00:00Z"], { stdin: "" });
    expect(stdin.code).toBe(2);
    expect(json(stdin.out).error.message).toContain("Input is empty.");
  });

  it("--exit-code leaves suggest and explain output byte-identical, and a book is exit 0", async () => {
    for (const cmd of ["suggest", "explain"] as const) {
      const plain = await run([cmd, "--json"], example(17));
      const flagged = await run([cmd, "--json", "--exit-code"], example(17));
      expect(flagged.out).toBe(plain.out);
      expect([plain.code, flagged.code]).toEqual([0, 1]);
    }
    expect((await run(["suggest", "--json", "--exit-code"], example(1))).code).toBe(0);
  });

  it("human-mode ambiguous zone: exit 3, nothing on stdout, one stderr line", async () => {
    const r = await run(["check"], example(23));
    expect(r.code).toBe(3);
    expect(r.out).toBe("");
    expect(r.err.trimEnd().split("\n")).toHaveLength(1);
    expect(r.err).toContain("AMBIGUOUS_ZONE");
  });

  // Finding F1 of docs/reviews/m3-cli-tests.md, decided as option (a) in A-85: the human line lists the
  // candidate zones that --json carries in details.options.
  it("human-mode ambiguous zone lists the candidate zones on the same line (A-85)", async () => {
    const human = await run(["check"], example(23));
    const asJson = await run(["check", "--json"], example(23));
    const options = json(asJson.out).error.details.options as string[];
    expect(options.length).toBeGreaterThan(1);
    expect(human.err.trimEnd().split("\n")).toHaveLength(1);
    expect(human.err).toContain(`Candidates: ${options.join(", ")}`);
  });
});
