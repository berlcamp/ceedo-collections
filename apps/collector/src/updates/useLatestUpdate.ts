import { useEffect, useState } from "react";
import * as Updates from "expo-updates";

/**
 * How long a cold start waits for a newer update before opening on the bundle it has.
 * Long enough for a manifest check and a JS download on market Wi-Fi, short enough that an
 * offline tablet at the stalls is not held behind the splash.
 */
const DEADLINE_MS = 8000;

/**
 * Brings the app to the newest published update ON THIS LAUNCH, not the next one.
 *
 * Left to itself, expo-updates downloads a new update in the background and applies it on
 * the launch after, so a freshly installed tablet (whose APK carries the bundle from build
 * time) needed two or three restarts to catch up. Here the launch checks first and, if
 * something newer downloads within the deadline, reloads into it once.
 *
 * This runs only at startup, before the database is touched, so it can never reload the
 * app under a collector mid-round. A download that misses the deadline is not abandoned:
 * it finishes in the background and applies on the next launch, as before.
 *
 * Returns true once the app may render.
 */
export function useLatestUpdate(): boolean {
  // Dev builds and Expo Go have no update channel to check.
  const [ready, setReady] = useState(!Updates.isEnabled);

  useEffect(() => {
    if (!Updates.isEnabled) return;
    let expired = false;
    const deadline = setTimeout(() => {
      expired = true;
      setReady(true);
    }, DEADLINE_MS);

    (async () => {
      try {
        const check = await Updates.checkForUpdateAsync();
        if (check.isAvailable && !expired) {
          const fetched = await Updates.fetchUpdateAsync();
          // Past the deadline the collector is already using the app; the update waits.
          if ((fetched.isNew || fetched.isRollBackToEmbedded) && !expired) {
            await Updates.reloadAsync();
            return;
          }
        }
      } catch {
        // Offline or the update server is unreachable: open on what is installed.
      }
      clearTimeout(deadline);
      setReady(true);
    })();

    return () => clearTimeout(deadline);
  }, []);

  return ready;
}
