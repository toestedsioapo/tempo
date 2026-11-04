import { TextDecoder } from "node:util";
import type { ErrorResult } from "@marvinliem/tempo-core";

/** Everything the CLI needs from the outside world (ARCHITECTURE §3, A-74). Only `bin.ts` builds the real one. */
export interface Env {
  readStdin(): Promise<Uint8Array>;
  /** Rejects like `fs`: `error.code` is `ENOENT`, `EISDIR`, `EACCES`, … */
  readFile(path: string): Promise<Uint8Array>;
  stdinIsTTY: boolean;
  write(s: string): void;
  writeErr(s: string): void;
  /** Real clock, whole-second UTC `…Z`. */
  now(): string;
  version: string;
}

export type Decoded = { ok: true; text: string } | { ok: false; message: string };
export type Parsed = { ok: true; value: unknown } | { ok: false; message: string };

const EMPTY: Decoded = { ok: false, message: "Input is empty." };

/**
 * Bytes -> text. UTF-8 (BOM optional) and UTF-16 LE/BE with a BOM are accepted (A-74);
 * decoding is fatal, so a stray byte is an error rather than a replacement character.
 */
export function decodeInput(bytes: Uint8Array): Decoded {
  if (bytes.length === 0) return EMPTY;
  const b0 = bytes[0];
  const b1 = bytes[1];
  let text: string;
  try {
    if (b0 === 0xff && b1 === 0xfe) {
      text = new TextDecoder("utf-16le", { fatal: true, ignoreBOM: false }).decode(bytes);
    } else if (b0 === 0xfe && b1 === 0xff) {
      text = new TextDecoder("utf-16be", { fatal: true, ignoreBOM: false }).decode(bytes);
    } else {
      text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
    }
  } catch {
    return {
      ok: false,
      message: "Input is not valid text. Expected UTF-8 (BOM optional) or UTF-16 with a BOM.",
    };
  }
  // BOM-less UTF-16 is valid UTF-8 full of NUL bytes; JSON text never contains a raw NUL.
  if (text.includes("\u0000")) {
    return {
      ok: false,
      message: "Input contains NUL characters (UTF-16 without a BOM?). Expected UTF-8 or UTF-16 with a BOM.",
    };
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // a doubled BOM (e.g. UTF-8 BOM before an encoded U+FEFF) is still stripped once more
  if (text.trim() === "") return EMPTY;
  return { ok: true, text };
}

export function parseJsonText(text: string): Parsed {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch (e) {
    return { ok: false, message: `Invalid JSON: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** An `ErrorResult` the CLI itself originates (A-76). `details` is omitted when undefined. */
export function cliError(
  code: "INVALID_INPUT" | "INTERNAL_ERROR",
  message: string,
  details?: Record<string, unknown>,
): ErrorResult {
  return { ok: false, error: details === undefined ? { code, message } : { code, message, details } };
}
