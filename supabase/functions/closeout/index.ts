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

  const { data, error } = await auth.client.rpc("close_shift", {
    p_shift_id: body.shift_id,
    p_device_id: auth.deviceId,
    p_declared_total: body.declared_total,
    p_device_count: body.device_count,
    p_device_total: body.device_total,
  });
  if (error) return fail("closeout_failed", 500);

  return json(data);
});
