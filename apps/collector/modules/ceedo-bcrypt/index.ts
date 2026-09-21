import CeedoBcryptModule from "./src/CeedoBcryptModule";

/**
 * Native bcrypt verification, for offline collector sign-in.
 *
 * `bcryptjs` under Hermes measured a median of 22,265 ms for one cost-12 verification on the
 * target tablet, in a release build. This module does the same work in Java under ART.
 * Reasoning and measurements: docs/superpowers/measurements/phase-3b-i-bcrypt-hermes.md
 *
 * Android only. Parent spec §3 targets Android 13+ LGU-issued tablets and rules out BYOD, so
 * there is no iOS device to serve; `CeedoBcryptModule.web.ts` exists only so a web bundle can
 * resolve the import, and throws if actually called.
 */

/**
 * The cost factor this system's hashes are expected to carry.
 *
 * `set_collector_pin()` uses `gen_salt('bf', 12)` (migration 0027). Spec D3 makes cost the
 * PIN's ONLY mitigation: ~20 bits of entropy means ~10^6 candidates, which is hours at a low
 * cost factor and days at 12. A hash arriving at a lower cost is either a server
 * misconfiguration or something worse, and either way it is not a thing to sign in against
 * silently.
 */
export const EXPECTED_COST = 12;

/**
 * Verifies a PIN against a synced bcrypt hash.
 *
 * Returns false -- never throws -- for an empty or malformed hash, so a collector whose
 * `pin_hash` is null reaches sign-in's own "PIN not set" message rather than a crash. §6.3
 * records why that distinction matters in the field.
 */
export function verify(pin: string, hash: string): boolean {
  return CeedoBcryptModule.verify(pin, hash);
}

/** The cost factor encoded in `hash`, or -1 if it cannot be read. */
export function costOf(hash: string): number {
  return CeedoBcryptModule.costOf(hash);
}

/**
 * Whether a hash carries at least the cost this system expects.
 *
 * Callers use this to notice a weakened hash rather than to reject a sign-in: refusing to
 * authenticate a collector because the SERVER was misconfigured would punish the wrong
 * person, at 5am, for something they cannot fix. Surface it, log it, let them work.
 */
export function meetsExpectedCost(hash: string): boolean {
  const cost = costOf(hash);
  return cost >= EXPECTED_COST;
}
