import { describe, expect, it } from "vitest";
import { cliError, decodeInput, parseJsonText } from "./io.js";

const enc = (s: string) => new TextEncoder().encode(s);
const bytes = (...n: number[]) => Uint8Array.from(n);
const concat = (...parts: Uint8Array[]) => Uint8Array.from(parts.flatMap((p) => [...p]));

function utf16(s: string, order: "le" | "be", bom: boolean): Uint8Array {
  const out: number[] = bom ? (order === "le" ? [0xff, 0xfe] : [0xfe, 0xff]) : [];
  for (const ch of s) {
    const c = ch.charCodeAt(0);
    out.push(...(order === "le" ? [c & 0xff, c >> 8] : [c >> 8, c & 0xff]));
  }
  return Uint8Array.from(out);
}

describe("decodeInput", () => {
  it("decodes plain UTF-8", () => {
    expect(decodeInput(enc('{"a":"é"}'))).toEqual({ ok: true, text: '{"a":"é"}' });
  });

  it("strips a UTF-8 BOM", () => {
    expect(decodeInput(concat(bytes(0xef, 0xbb, 0xbf), enc("{}")))).toEqual({ ok: true, text: "{}" });
  });

  it("decodes UTF-16 LE with BOM (Windows PowerShell 5.1 redirection)", () => {
    expect(decodeInput(utf16('{"a":"é"}', "le", true))).toEqual({ ok: true, text: '{"a":"é"}' });
  });

  it("decodes UTF-16 BE with BOM", () => {
    expect(decodeInput(utf16('{"a":"é"}', "be", true))).toEqual({ ok: true, text: '{"a":"é"}' });
  });

  it("rejects invalid UTF-8 instead of producing replacement characters", () => {
    const r = decodeInput(bytes(0x7b, 0xff, 0x7d));
    expect(r.ok).toBe(false);
    expect(!r.ok && r.message).toContain("UTF-8");
  });

  it("rejects UTF-16 without a BOM", () => {
    expect(decodeInput(utf16("{}", "le", false)).ok).toBe(false);
  });

  it("rejects empty input", () => {
    expect(decodeInput(new Uint8Array())).toEqual({ ok: false, message: "Input is empty." });
  });

  it("rejects input that is only a BOM or whitespace", () => {
    expect(decodeInput(bytes(0xef, 0xbb, 0xbf))).toEqual({ ok: false, message: "Input is empty." });
    expect(decodeInput(enc(" \r\n\t "))).toEqual({ ok: false, message: "Input is empty." });
  });

  it("rejects an odd-length UTF-16 body", () => {
    expect(decodeInput(bytes(0xff, 0xfe, 0x7b)).ok).toBe(false);
  });
});

describe("parseJsonText", () => {
  it("parses CRLF-formatted JSON", () => {
    expect(parseJsonText('{\r\n  "a": 1\r\n}\r\n')).toEqual({ ok: true, value: { a: 1 } });
  });

  it("parses JSON that is not an object", () => {
    expect(parseJsonText("null")).toEqual({ ok: true, value: null });
  });

  it("rejects trailing garbage and reports the JSON.parse reason", () => {
    const r = parseJsonText('{"a":1} x');
    expect(r.ok).toBe(false);
    expect(!r.ok && r.message).toMatch(/^Invalid JSON: ./);
  });
});

describe("cliError", () => {
  it("builds an ErrorResult with details", () => {
    expect(cliError("INVALID_INPUT", "bad", { source: "file" })).toEqual({
      ok: false,
      error: { code: "INVALID_INPUT", message: "bad", details: { source: "file" } },
    });
  });

  it("omits details when there are none", () => {
    expect(cliError("INTERNAL_ERROR", "boom")).toStrictEqual({
      ok: false,
      error: { code: "INTERNAL_ERROR", message: "boom" },
    });
  });
});
