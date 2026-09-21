import { authenticateDevice } from "../_shared/auth.ts";
import { fail, json } from "../_shared/respond.ts";
import { validateBody } from "../_shared/validate.ts";
import { CloseoutRequest } from "../_shared/contract.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST") return fail("method_not_allowed", 405);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail("bad_request", 400);
  }

  // Before authentication -- see validate.ts on why that order is deliberate.
  const valid = validateBody(CloseoutRequest, body);
  if (!valid.ok) return valid.response;

  const auth = await authenticateDevice(valid.value.credential_id, valid.value.secret);
  if (!auth) return fail("unauthorized", 401);

  const { data, error } = await auth.client.rpc("close_shift", {
    p_shift_id: valid.value.shift_id,
    p_device_id: auth.deviceId,
    p_declared_total: valid.value.declared_total,
    p_device_count: valid.value.device_count,
    p_device_total: valid.value.device_total,
  });
  if (error) return fail("closeout_failed", 500);

  return json(data);
});
