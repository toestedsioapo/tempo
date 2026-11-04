import type { Env } from "../src/io.js";

type Bytes = string | Uint8Array;
const toBytes = (b: Bytes): Uint8Array => (typeof b === "string" ? new TextEncoder().encode(b) : b);

export interface FakeEnvOptions extends Partial<Env> {
  /** Bytes returned by `readStdin`. */
  stdin?: Bytes;
  /** Files by path; any other path rejects like `fs` (`code: "ENOENT"`). */
  files?: Record<string, Bytes>;
}

export type FakeEnv = Env & { out: string[]; err: string[] };

export const FAKE_NOW = "2030-01-01T00:00:00Z";

/** The only way tests build an `Env` (plan M3, conventions). Captures stdout/stderr in `out` / `err`. */
export function fakeEnv(over: FakeEnvOptions = {}): FakeEnv {
  const { stdin, files, ...rest } = over;
  const out: string[] = [];
  const err: string[] = [];
  const env: FakeEnv = {
    readStdin: async () => toBytes(stdin ?? ""),
    readFile: async (path: string) => {
      const hit = files?.[path];
      if (hit === undefined) throw Object.assign(new Error(`ENOENT: no such file or directory, open '${path}'`), { code: "ENOENT" });
      return toBytes(hit);
    },
    stdinIsTTY: false,
    write: (s: string) => void out.push(s),
    writeErr: (s: string) => void err.push(s),
    now: () => FAKE_NOW,
    version: "0.0.0-test",
    ...rest,
    out,
    err,
  };
  return env;
}
