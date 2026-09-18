import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { create, getNumericDate } from "https://deno.land/x/djwt@v3.0.2/mod.ts";

/**
 * The ceedo_app client.
 *
 * Parent spec §12.5: "Edge Functions must not use service_role" -- which bypasses RLS
 * across every unrelated schema on this shared Supabase project. So this mints a JWT with
 * the ceedo_app role claim, signed with the project JWT secret, and PostgREST does
 * `set role ceedo_app` on the strength of it.
 *
 * ceedo_app holds EXECUTE on exactly four functions and no privilege on any table, view or
 * matview, so a leaked token of this kind can call four functions -- each with its own
 * internal authorization -- and read no row directly. It does hold USAGE, SELECT on two
 * SEQUENCES (row_version_seq, audit_log_id_seq; migration 0001), which leaks a pair of
 * counters and no data. Both facts are pinned by tests/db/sync-privileges.test.ts.
 */
let cached: SupabaseClient | null = null;

export async function ceedoAppClient(): Promise<SupabaseClient> {
  if (cached) return cached;

  const secret = Deno.env.get("CEEDO_JWT_SECRET");
  const url = Deno.env.get("SUPABASE_URL");
  // The anon key is the API GATEWAY's credential; the ceedo_app JWT is the DATABASE ROLE's.
  // They are different headers doing different jobs, and collapsing them works by accident
  // until the gateway's rules change.
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!secret || !url || !anonKey) {
    throw new Error("CEEDO_JWT_SECRET, SUPABASE_URL and SUPABASE_ANON_KEY must be set");
  }

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );

  // Long-lived because the process is short-lived; it never leaves this function.
  const token = await create(
    { alg: "HS256", typ: "JWT" },
    { role: "ceedo_app", exp: getNumericDate(60 * 60) },
    key,
  );

  // apikey = anon (gets past the gateway). Authorization = ceedo_app (sets the DB role).
  cached = createClient(url, anonKey, {
    db: { schema: "ceedo_collections" },
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  return cached;
}

export type Authenticated = { deviceId: string; client: SupabaseClient };

/**
 * Verifies the presented credential and returns the device id.
 *
 * The device id is taken from HERE and never from the request body. Invariant 21: a device
 * may claim any collector_id -- the PIN was verified offline, so that claim is unverifiable
 * by construction and §11.5 accepts it -- but it must not be able to claim to be a
 * different tablet.
 */
export async function authenticateDevice(
  credentialId: unknown,
  secret: unknown,
): Promise<Authenticated | null> {
  if (typeof credentialId !== "string" || typeof secret !== "string") return null;

  const client = await ceedoAppClient();
  const { data, error } = await client.rpc("authenticate_device", {
    p_credential_id: credentialId,
    p_secret: secret,
  });
  if (error || !data) return null;

  return { deviceId: data as string, client };
}
