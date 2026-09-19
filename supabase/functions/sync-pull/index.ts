import { authenticateDevice } from "../_shared/auth.ts";
import { fail, json } from "../_shared/respond.ts";
import { validateBody } from "../_shared/validate.ts";
import { PullRequest } from "../_shared/contract.ts";

// Thin by design (spec §4.5): parse, validate, authenticate, call ONE rpc, return its
// jsonb. Scoping, cursoring and the collections-not-charges rule all live in sync_pull(),
// where the tests/db harness that proved post_collection can reach them.
Deno.serve(async (req) => {
  if (req.method !== "POST") return fail("method_not_allowed", 405);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail("bad_request", 400);
  }

  // Before authentication -- see validate.ts on why that order is deliberate.
  const valid = validateBody(PullRequest, body);
  if (!valid.ok) return valid.response;

  const auth = await authenticateDevice(valid.value.credential_id, valid.value.secret);
  if (!auth) return fail("unauthorized", 401);

  const { data, error } = await auth.client.rpc("sync_pull", {
    p_device_id: auth.deviceId,
    // The schema defaults an absent cursor to 0, which is what the hand-rolled
    // `typeof body.cursor === "number" ? body.cursor : 0` did -- except a cursor sent as a
    // string now fails validation instead of silently restarting the device's sync.
    p_cursor: valid.value.cursor,
  });
  if (error) return fail("sync_failed", 500);

  return json(data);
});
