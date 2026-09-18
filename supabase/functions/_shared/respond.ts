/** JSON responses, shaped identically by all three functions. */

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * A failure the caller can act on. The message is deliberately terse: this endpoint is
 * reached by an unauthenticated client over the public internet, and a Postgres error
 * string can name tables, columns and constraints.
 */
export function fail(code: string, status: number): Response {
  return json({ error: code }, status);
}
