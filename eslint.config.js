import js from "@eslint/js";
import tseslint from "typescript-eslint";

const bannedModules = [
  "node:*",
  "fs",
  "fs/promises",
  "path",
  "os",
  "child_process",
  "http",
  "https",
  "net",
  "crypto",
  "**/Temporal*",
];

const message = "Core must be pure (CLAUDE.md hard rules): no clock, randomness, I/O or environment access.";

const bannedGlobals = ["process", "fetch", "Buffer", "Temporal", "crypto", "performance"].map((name) => ({ name, message }));

const bannedSyntax = [
  { selector: "Identifier[name='Date']", message: "Raw JS Date is banned; use Luxon DateTime with explicit zones." },
  {
    selector: "CallExpression[callee.object.name='Math'][callee.property.name='random']",
    message: "Randomness is banned in core.",
  },
  // Explicit-zone parsing (e.g. zone-less DateTime.fromISO) is not statically decidable; it is enforced by review and tests, not lint.
  {
    selector: "CallExpression[callee.object.name='DateTime'][callee.property.name=/^(now|local)$/]",
    message: "DateTime.now()/local() read the system clock; the clock arrives as an argument (`now` is an input).",
  },
  {
    selector: "CallExpression[callee.object.name='DateTime'][callee.property.name='utc'][arguments.length=0]",
    message: "Zero-argument DateTime.utc() reads the system clock; the clock arrives as an argument (`now` is an input).",
  },
];

export default tseslint.config(
  { ignores: ["**/dist/**", "**/node_modules/**", "schema/**", "**/coverage/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["packages/core/src/**/*.ts"],
    rules: {
      "no-restricted-imports": ["error", { patterns: bannedModules.map((group) => ({ group: [group], message })) }],
      "no-restricted-globals": ["error", ...bannedGlobals],
      "no-restricted-syntax": ["error", ...bannedSyntax],
    },
  },
  {
    files: ["packages/core/src/**/*.test.ts", "packages/core/test/**/*.ts"],
    rules: {
      "no-restricted-imports": "off",
      "no-restricted-globals": ["error", ...bannedGlobals.filter((g) => g.name !== "process")],
      "no-restricted-syntax": ["error", ...bannedSyntax],
    },
  },
);
