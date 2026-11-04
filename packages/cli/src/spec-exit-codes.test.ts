import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { main } from "./main.js";
import { fakeEnv } from "../test/env.js";
import { example } from "../test/fixtures.js";

const SPEC = readFileSync(resolve(import.meta.dirname, "../../../SPEC.md"), "utf8");

interface Expected {
  plain: number;
  flag: number;
}

function expectedFor(line: string): Expected {
  if (line === "`0` (with or without `--exit-code`)") return { plain: 0, flag: 0 };
  if (line === "`0`; `1` with `--exit-code`") return { plain: 0, flag: 1 };
  if (line === "`2`") return { plain: 2, flag: 2 };
  if (line === "`3`") return { plain: 3, flag: 3 };
  throw new Error(`Unrecognised CLI exit code line: ${line}`);
}

const sections = [...SPEC.matchAll(/^### (EX-\d\d)\b[\s\S]*?(?=^### |^## )/gm)].map((m) => {
  const body = m[0];
  const line = /^\*\*CLI exit code:\*\* (.+)$/m.exec(body)?.[1]?.trim();
  if (line === undefined) throw new Error(`${m[1]} has no CLI exit code line`);
  return { id: m[1] as string, expected: expectedFor(line) };
});

describe("every `CLI exit code` line in SPEC section 6 is asserted", () => {
  it("finds all 24 worked examples", () => {
    expect(sections.map((s) => s.id)).toEqual(
      Array.from({ length: 24 }, (_, i) => `EX-${String(i + 1).padStart(2, "0")}`),
    );
  });

  it("rejects a line it does not recognise", () => {
    expect(() => expectedFor("`7`")).toThrow(/Unrecognised/);
  });

  it.each(sections.map((s) => [s.id, s.expected] as const))("%s", async (id, expected) => {
    const fx = example(Number(id.slice(3)));
    const command = fx.entry === "evaluate" ? "check" : fx.entry;
    for (const [flag, want] of [
      [false, expected.plain],
      [true, expected.flag],
    ] as const) {
      const env = fakeEnv({ files: { "f.json": JSON.stringify(fx.input) } });
      const argv = [command, "--json", ...(flag ? ["--exit-code"] : []), "f.json"];
      expect(await main(argv, env), `${id} ${argv.join(" ")}`).toBe(want);
    }
  });
});
