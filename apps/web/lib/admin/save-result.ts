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
          // Trigger-raised messages are written for people, e.g. "Cannot change
          // facility X from market to terminal while it still has sections." A
          // plain CHECK constraint instead echoes raw SQL identifiers, e.g.
          // `new row for relation "leases" violates check constraint
          // "leases_dates_ordered"` — not fit to show a clerk.
          return /violates check constraint/.test(dbError.message)
            ? "That combination of values is not allowed."
            : dbError.message;
        case "23502":
          return "A required value is missing.";
        case "23P01":
          return "This overlaps an existing record for the same period or range.";
        case "42501":
          return "You do not have permission to change this.";
        case "PGRST116":
          // An RLS-blocked UPDATE and a stale id both surface here — PostgREST
          // cannot tell them apart ("Cannot coerce the result to a single JSON
          // object"), and neither can the client, so neither should the message.
          return "That record no longer exists, or you do not have permission to change it.";
        default:
          return dbError.message;
      }
    })();
    return { ok: false, fieldErrors: {}, formError };
  }

  return { ok: true, id };
}

export type DeleteResult = { ok: true } | { ok: false; formError: string };

/**
 * A delete is refused by a foreign key when anything still refers to the row (a tenant's
 * lease, a stall's lease, a facility's sections), and that refusal is the whole rule: no
 * separate "is it in use" check that could drift from the schema. RLS refuses silently
 * instead, deleting nothing, which is why the deleted count is checked too.
 */
export function toDeleteResult(
  dbError: DbError | null,
  deleted: number,
  inUseMessage: string,
): DeleteResult {
  if (dbError) {
    return {
      ok: false,
      formError:
        dbError.code === "23503"
          ? inUseMessage
          : dbError.code === "42501"
            ? "You do not have permission to delete this."
            : dbError.message,
    };
  }
  if (deleted === 0) {
    return {
      ok: false,
      formError: "That record no longer exists, or you do not have permission to delete it.",
    };
  }
  return { ok: true };
}
