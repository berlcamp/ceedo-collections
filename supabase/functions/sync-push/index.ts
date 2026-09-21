import { authenticateDevice } from "../_shared/auth.ts";
import { fail, json } from "../_shared/respond.ts";
import { validateBody } from "../_shared/validate.ts";
import { PushRequest } from "../_shared/contract.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST") return fail("method_not_allowed", 405);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail("bad_request", 400);
  }

  // Before authentication -- see validate.ts on why that order is deliberate. This also
  // replaces the bare `Array.isArray(body.entries)` check that used to sit below: a
  // non-array `entries` is now refused by the schema, and named as `entries`.
  const valid = validateBody(PushRequest, body);
  if (!valid.ok) return valid.response;

  const auth = await authenticateDevice(valid.value.credential_id, valid.value.secret);
  if (!auth) return fail("unauthorized", 401);

  const { data, error } = await auth.client.rpc("sync_push", {
    p_device_id: auth.deviceId,
    p_entries: valid.value.entries,
  });
  if (error) return fail("sync_failed", 500);

  return json(data);
});
