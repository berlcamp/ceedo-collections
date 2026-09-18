import { authenticateDevice } from "../_shared/auth.ts";
import { fail, json } from "../_shared/respond.ts";

// Thin by design (spec §4.5): parse, authenticate, call ONE rpc, return its jsonb. Scoping,
// cursoring and the collections-not-charges rule all live in sync_pull(), where the
// tests/db harness that proved post_collection can reach them.
Deno.serve(async (req) => {
  if (req.method !== "POST") return fail("method_not_allowed", 405);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return fail("bad_request", 400);
  }

  const auth = await authenticateDevice(body.credential_id, body.secret);
  if (!auth) return fail("unauthorized", 401);

  const cursor = typeof body.cursor === "number" ? body.cursor : 0;

  const { data, error } = await auth.client.rpc("sync_pull", {
    p_device_id: auth.deviceId,
    p_cursor: cursor,
  });
  if (error) return fail("sync_failed", 500);

  return json(data);
});
