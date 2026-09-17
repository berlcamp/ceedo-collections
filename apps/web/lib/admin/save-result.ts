import type { ZodSafeParseResult } from "zod";

export type SaveResult =
  | { ok: true; id: string }
  | { ok: false; fieldErrors: Record<string, string>; formError?: string };

export interface DbError {
  code: string;
  message: string;
}

/**
 * Turns a validation result and an optional database error into something a form
 * can render. Kept pure and separate from the action so the mapping of Postgres
 * error codes to human sentences is unit-tested rather than discovered in the UI.
 */
export function toSaveResult(
  parsed: ZodSafeParseResult<unknown>,
  dbError: DbError | null,
  id = "",
): SaveResult {
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.join(".");
      if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return { ok: false, fieldErrors };
  }

  if (dbError) {
    const formError = ((): string => {
      switch (dbError.code) {
        case "23505":
          return "A record with these details already exists.";
        case "23503":
          return "A referenced record does not exist.";
        case "23514":
          // Trigger and check-constraint messages are written for people.
          return dbError.message;
        case "23P01":
          return "This overlaps an existing record for the same period or range.";
        case "42501":
          return "You do not have permission to change this.";
        default:
          return dbError.message;
      }
    })();
    return { ok: false, fieldErrors: {}, formError };
  }

  return { ok: true, id };
}
