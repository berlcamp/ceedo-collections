import type { z } from "npm:zod@4";
import { fail, json } from "./respond.ts";

/**
 * Validates a request body, or returns the 400 to send back.
 *
 * WHAT CROSSES THE WIRE ON FAILURE, AND WHY IT IS NOT THE ZodError. This endpoint is
 * reached by an unauthenticated client over the public internet -- the same reason
 * respond.ts keeps its error codes terse. A zod issue carries a path and a message, which
 * is what a device developer needs to fix a payload; it can also carry received values,
 * which is what a payload's own contents would leak straight back out. Only `path` and
 * `message` are forwarded.
 *
 * VALIDATION RUNS BEFORE AUTHENTICATION, deliberately. A malformed body is malformed
 * whoever sent it, and telling a client its payload is wrong reveals nothing a reading of
 * the published contract would not. The reverse order would make every contract bug look
 * like a credential problem to whoever is holding the tablet.
 */
export function validateBody<T>(
  schema: z.ZodType<T>,
  body: unknown,
): { ok: true; value: T } | { ok: false; response: Response } {
  const parsed = schema.safeParse(body);
  if (parsed.success) return { ok: true, value: parsed.data };

  return {
    ok: false,
    response: json(
      {
        error: "invalid_body",
        detail: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
      400,
    ),
  };
}

export { fail };
