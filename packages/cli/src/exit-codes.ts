import type { ErrorCode } from "@marvinliem/tempo-core";

/** Public CLI exit-code contract (D14). Changing a value is a breaking change. */
export const EXIT = {
  OK: 0,
  COUNTER_OFFER: 1,
  INPUT_ERROR: 2,
  AMBIGUOUS_ZONE: 3,
  INTERNAL_ERROR: 4,
} as const;

/** Maps a core error code to its CLI exit code (G24). Exhaustive under `never`. */
export function exitCodeForError(code: ErrorCode): 2 | 3 | 4 {
  switch (code) {
    case "INVALID_INPUT":
    case "INVALID_ZONE":
    case "INVALID_INTERVAL":
    case "DST_NONEXISTENT_LOCAL_TIME":
    case "DST_AMBIGUOUS_LOCAL_TIME":
      return EXIT.INPUT_ERROR;
    case "AMBIGUOUS_ZONE":
      return EXIT.AMBIGUOUS_ZONE;
    case "INTERNAL_ERROR":
      return EXIT.INTERNAL_ERROR;
    default: {
      const unreachable: never = code;
      return unreachable;
    }
  }
}
