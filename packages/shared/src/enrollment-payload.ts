/**
 * The text a QR code carries, and the text an admin types as the fallback.
 *
 * Shared shape, one definition, deliberately: a QR that encodes something the manual path
 * cannot parse would make the fallback a different feature rather than a fallback.
 *
 * IN packages/shared, NOT in apps/web, and for the same reason. BOTH ends run this code --
 * the web encodes, the tablet decodes -- and they are separate bundles that cannot import
 * across each other. A copy in each would be two definitions of one format, free to drift,
 * whose divergence shows up as a tablet that will not enrol and no error saying why.
 *
 * Format: `ceedo1:<credentialId>:<secret>:<checksum>`
 */
const PREFIX = "ceedo1";

/**
 * A 4-hex-digit checksum over credentialId and secret.
 *
 * Not a security control -- the secret is in the payload in plaintext, and it has to be,
 * because that is what the device must store. This exists to catch a typo at the moment of
 * entry rather than at the first sync, where a wrong secret is indistinguishable from a
 * revoked credential or an unreachable server.
 */
function checksum(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return (hash & 0xffff).toString(16).padStart(4, "0");
}

export function encodeEnrollment(credentialId: string, secret: string): string {
  const body = `${credentialId}:${secret}`;
  return `${PREFIX}:${body}:${checksum(body)}`;
}

export function decodeEnrollment(
  text: string,
): { credentialId: string; secret: string } | null {
  const parts = text.trim().split(":");
  if (parts.length !== 4) return null;
  const [prefix, credentialId, secret, sum] = parts;
  if (prefix !== PREFIX || !credentialId || !secret || !sum) return null;
  if (checksum(`${credentialId}:${secret}`) !== sum) return null;
  return { credentialId, secret };
}
