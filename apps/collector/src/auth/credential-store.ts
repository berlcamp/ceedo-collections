import * as SecureStore from "expo-secure-store";

export interface Credential {
  credentialId: string;
  secret: string;
}

const KEY = "ceedo.device.credential";

/**
 * KEYSTORE-BACKED STORAGE, NEVER AsyncStorage. Mandatory, per the Phase 3a handover.
 *
 * The device credential is long-lived and has NO expiry (spec D2 -- any expiry
 * reintroduces the failure OAuth was rejected for: a tablet that wakes offline with a dead
 * token cannot record anything until it finds signal). Its secret is checked only by hash
 * server-side (D3). So a leaked plaintext secret is a standing liability with nothing
 * bounding it, and AsyncStorage is unencrypted application-readable disk.
 *
 * expo-secure-store puts it behind the Android Keystore. Revocation is server-side --
 * `revoke_device_credential` -- and takes effect on the device's next contact, which is
 * also the only moment it could do any harm.
 */
export async function saveCredential(credential: Credential): Promise<void> {
  await SecureStore.setItemAsync(KEY, JSON.stringify(credential), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

export async function loadCredential(): Promise<Credential | null> {
  const raw = await SecureStore.getItemAsync(KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Credential;
    if (!parsed.credentialId || !parsed.secret) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Used when a device is re-enrolled, NOT when a collector signs out. Signing out clears a
 * session, never data (parent §6.4), and the credential belongs to the tablet rather than
 * to whoever is holding it.
 */
export async function clearCredential(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY);
}
