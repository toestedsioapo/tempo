#!/usr/bin/env node
// The only file that touches `process` (CLI-13 / purity of `main`). Never calls process.exit():
// that can truncate piped output on Windows, so the exit status goes through process.exitCode.
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { systemNow } from "./clock.js";
import type { Env } from "./io.js";
import { main } from "./main.js";

async function readStdin(): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Uint8Array);
  return Buffer.concat(chunks);
}

function packageVersion(): string {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
  return pkg.version;
}

// A consumer that goes away (`tempo explain f | head -1`) is a normal end, not a crash: stop
// writing and keep the exit status.
let stdoutClosed = false;
process.stdout.on("error", (e: NodeJS.ErrnoException) => {
  stdoutClosed = true;
  if (e.code !== "EPIPE" && e.code !== "ERR_STREAM_DESTROYED" && e.code !== "ECONNRESET") process.exitCode = 4;
});
process.stderr.on("error", () => undefined);

const env: Env = {
  readStdin,
  readFile: (path) => readFile(path),
  stdinIsTTY: process.stdin.isTTY === true,
  write: (s) => {
    if (!stdoutClosed) process.stdout.write(s);
  },
  writeErr: (s) => {
    process.stderr.write(s);
  },
  now: systemNow,
  version: packageVersion(),
};

const code = await main(process.argv.slice(2), env);
if (process.exitCode === undefined || process.exitCode === 0) process.exitCode = code;
