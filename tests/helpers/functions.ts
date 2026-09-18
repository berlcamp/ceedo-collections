const BASE =
  process.env.FUNCTIONS_URL ??
  `${process.env.SUPABASE_URL ?? process.env.API_URL ?? "http://127.0.0.1:54321"}/functions/v1`;

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
