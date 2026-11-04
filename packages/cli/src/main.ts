import type { ErrorResult, NegotiationRequest } from "@marvinliem/tempo-core";
import { helpText, parseCli } from "./args.js";
import { commands } from "./commands.js";
import { EXIT, exitCodeForError } from "./exit-codes.js";
import { cliError, decodeInput, parseJsonText, type Env } from "./io.js";
import { withNow } from "./now.js";
import { renderErrorLine, renderJson } from "./render.js";

type Loaded = { ok: true; value: unknown } | { ok: false; error: ErrorResult };

/** The `fs`-style `error.code` (ENOENT, EISDIR, EACCES, …) when there is one. */
function errorCode(e: unknown): string | undefined {
  return typeof e === "object" && e !== null && "code" in e && typeof e.code === "string" ? e.code : undefined;
}

/** bytes -> text -> JSON, with every failure as an INVALID_INPUT ErrorResult (A-76). */
async function load(file: string | undefined, env: Env): Promise<Loaded> {
  const where = file === undefined ? "stdin" : `'${file}'`;
  const details = file === undefined ? { source: "stdin" } : { source: "file", path: file };
  if (file === undefined && env.stdinIsTTY) {
    return {
      ok: false,
      error: cliError("INVALID_INPUT", "No input: pass a file, or pipe a JSON request on stdin.", details),
    };
  }
  let bytes: Uint8Array;
  try {
    bytes = file === undefined ? await env.readStdin() : await env.readFile(file);
  } catch (e) {
    const code = errorCode(e);
    const why = code ?? (e instanceof Error ? e.message : String(e));
    return {
      ok: false,
      error: cliError("INVALID_INPUT", `Cannot read ${where}: ${why}`, code === undefined ? details : { ...details, code }),
    };
  }
  const decoded = decodeInput(bytes);
  if (!decoded.ok) return { ok: false, error: cliError("INVALID_INPUT", `${where}: ${decoded.message}`, details) };
  const parsed = parseJsonText(decoded.text);
  if (!parsed.ok) return { ok: false, error: cliError("INVALID_INPUT", `${where}: ${parsed.message}`, details) };
  return { ok: true, value: parsed.value };
}

function emitError(env: Env, json: boolean, result: ErrorResult): number {
  if (json) env.write(renderJson(result));
  else env.writeErr(`${renderErrorLine(result.error)}\n`);
  return exitCodeForError(result.error.code);
}

async function run(argv: string[], env: Env): Promise<number> {
  const parsed = parseCli(argv);
  switch (parsed.kind) {
    case "help":
      env.write(helpText(parsed.command));
      return EXIT.OK;
    case "version":
      env.write(`${env.version}\n`);
      return EXIT.OK;
    case "usage-error":
      if (argv.length === 0) {
        env.writeErr(`${renderErrorLine(cliError("INVALID_INPUT", parsed.message).error)}\n\n${helpText()}`);
        return EXIT.INPUT_ERROR;
      }
      return emitError(env, parsed.json, cliError("INVALID_INPUT", parsed.message, { source: "argv" }));
    case "run": {
      const loaded = await load(parsed.file, env);
      if (!loaded.ok) return emitError(env, parsed.json, loaded.error);
      const input = withNow(loaded.value, parsed.now, () => env.now());
      const result = commands[parsed.command](input as NegotiationRequest);
      if (!result.ok) return emitError(env, parsed.json, result);
      env.write(renderJson(result));
      return parsed.exitCode && result.decision === "counter_offer" ? EXIT.COUNTER_OFFER : EXIT.OK;
    }
  }
}

/**
 * The whole CLI as a function of its arguments and an injected `Env`. Never throws or rejects;
 * writes only through `env`; resolves to the exit code. Anything unexpected is INTERNAL_ERROR (exit 4).
 */
export async function main(argv: string[], env: Env): Promise<number> {
  try {
    return await run(argv, env);
  } catch {
    // Never leak the exception text or a stack trace (determinism, A-63 style).
    const result = cliError("INTERNAL_ERROR", "Internal error: tempo failed unexpectedly. This is a bug.");
    try {
      emitError(env, argv.includes("--json"), result);
    } catch {
      // Output itself is broken; the exit code is all that is left.
    }
    return EXIT.INTERNAL_ERROR;
  }
}
