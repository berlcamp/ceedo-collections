import type { Transport } from "@ceedo/sync-engine";

/**
 * The device's HTTP transport. The other implementation of this interface is the one
 * tests/device passes, which calls the same Edge Functions through the same Kong gateway.
 *
 * THE apikey/Authorization PAIR IS THE GATEWAY'S CREDENTIAL, NOT THE DEVICE'S. Without it
 * Kong answers 401 before the Function runs, with a body of its own -- which is why
 * tests/helpers/functions.ts insists every 401 assertion checks the body. The DEVICE's
 * credential is `credential_id`/`secret` inside the JSON body, and it is the only one that
 * identifies this tablet.
 *
 * Both values are public by construction: the anon key is shipped in every Supabase client
 * and grants nothing on its own, since the Edge Functions mint a short-lived `ceedo_app`
 * JWT per invocation and never use `service_role` (parent spec §12.5).
 */
export function httpTransport(config: { apiUrl: string; anonKey: string }): Transport {
  return {
    async post(fn, body) {
      const res = await fetch(`${config.apiUrl}/functions/v1/${fn}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          apikey: config.anonKey,
          Authorization: `Bearer ${config.anonKey}`,
        },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      return { status: res.status, body: text ? (JSON.parse(text) as unknown) : null };
    },
  };
}
