/**
 * Where this build talks to, read from EXPO_PUBLIC_* at bundle time.
 *
 * NOT from a screen and not from the enrollment payload. The payload carries the device's
 * identity; the server it belongs to is a property of the BUILD, so a tablet flashed for
 * this deployment cannot be pointed at another one by whoever is holding it.
 *
 * babel-preset-expo inlines `process.env.EXPO_PUBLIC_*` as literals, which is why each is
 * read as a direct member expression rather than through a helper or a destructure -- an
 * indirect read is not inlined and arrives as undefined on the device.
 *
 * A FUNCTION, NOT A MODULE-LEVEL CONSTANT. Throwing at import time would white-screen the
 * whole app, including the two probe screens that need no server at all. Throwing at the
 * point of use lets the enrollment screen catch it and say what is actually wrong, which is
 * the difference between a rebuild and an afternoon.
 */
export interface ApiConfig {
  apiUrl: string;
  anonKey: string;
}

export function apiConfig(): ApiConfig {
  const apiUrl = process.env.EXPO_PUBLIC_API_URL;
  const anonKey = process.env.EXPO_PUBLIC_ANON_KEY;
  const missing = [
    apiUrl ? null : "EXPO_PUBLIC_API_URL",
    anonKey ? null : "EXPO_PUBLIC_ANON_KEY",
  ].filter(Boolean);

  if (missing.length > 0 || !apiUrl || !anonKey) {
    throw new Error(
      `This build has no server configured (${missing.join(", ")}). It cannot sync. ` +
        "Rebuild with those values set; they are baked in at bundle time and cannot be " +
        "entered here.",
    );
  }
  return { apiUrl, anonKey };
}
