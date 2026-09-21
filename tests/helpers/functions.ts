/**
 * The gateway base URL, exported so tests that must bypass `callFunction()` (to send a raw
 * GET or a deliberately malformed body) build their own request against the same host it
 * hits -- rather than repeating this fallback chain a third time with one link missing.
 * `SUPABASE_URL` and `API_URL` are both names `supabase status -o env` (or a hand-set
 * override) may use; on a machine running more than one Supabase stack, dropping either link
 * risks falling through to the hardcoded default and silently hitting the wrong project's
 * gateway.
 */
// 56321, not the 54321 default. The comment above is right and the old default
// contradicted it: school-management owns 54321 on this machine, so falling through
// to it silently hit that project's gateway instead of failing.
export const GATEWAY_URL =
  process.env.SUPABASE_URL ?? process.env.API_URL ?? "http://127.0.0.1:56321";

const BASE = process.env.FUNCTIONS_URL ?? `${GATEWAY_URL}/functions/v1`;

/**
 * The apikey/Authorization pair is the API GATEWAY's credential and is NOT optional.
 *
 * Without it Kong rejects the request before the Function ever runs — and it answers with
 * its own 401. Both Kong and our handler return 401, so a test that asserts only on the
 * status code passes identically whether the Function works, is broken, or was never
 * deployed. Verified directly:
 *
 *   no apikey   -> 401 {"code":"UNAUTHORIZED_NO_AUTH_HEADER", ...}   <- Kong
 *   with apikey -> 401 {"error":"unauthorized"}                      <- our handler
 *
 * Every assertion on a 401 in this suite must therefore check the BODY, not the status.
 */
const ANON = process.env.SUPABASE_ANON_KEY ?? process.env.ANON_KEY ?? "";

export async function callFunction(
  name: string,
  body: unknown,
): Promise<{ status: number; body: any }> {
  const res = await fetch(`${BASE}/${name}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      apikey: ANON,
      Authorization: `Bearer ${ANON}`,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}
