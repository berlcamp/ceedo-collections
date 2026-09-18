import { authenticateDevice } from "../_shared/auth.ts";
import { fail, json } from "../_shared/respond.ts";

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

  if (!Array.isArray(body.entries)) return fail("bad_request", 400);

  const { data, error } = await auth.client.rpc("sync_push", {
    p_device_id: auth.deviceId,
    p_entries: body.entries,
  });
  if (error) return fail("sync_failed", 500);

  return json(data);
});
