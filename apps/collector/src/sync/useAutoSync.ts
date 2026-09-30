import { useCallback, useEffect } from "react";
import { AppState } from "react-native";
import { useFocusEffect } from "expo-router";
import { holdAutoSync, syncSoon } from "./device-sync";

/**
 * Syncs on its own whenever the tablet might have signal: at launch, when the app comes back
 * to the foreground, and every two minutes while it is open.
 *
 * "WHENEVER THERE IS SIGNAL" IS "TRY, AND FAIL QUIETLY". Knowing about signal ahead of time
 * needs a native module, and a native module means a new APK on every tablet rather than an
 * update over the air. Trying costs one request that times out (transport.ts), and a sync
 * that fails changes nothing on the device.
 *
 * NOT A BACKGROUND TASK. Android runs those on its own schedule, fifteen minutes at the
 * soonest and often not at all on a tablet saving power -- a promise this app could not keep.
 * The receipt at risk is the one taken while the app is open, and that is when this runs.
 *
 * Mounted once, in the root layout, after the device schema is migrated.
 */
export function useAutoSync(): void {
  useEffect(() => {
    syncSoon();

    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (!timer) timer = setInterval(() => syncSoon(), AUTO_SYNC_EVERY_MS);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    if (AppState.currentState === "active") start();

    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        syncSoon();
        start();
      } else {
        stop();
      }
    });

    return () => {
      stop();
      subscription.remove();
    };
  }, []);
}

const AUTO_SYNC_EVERY_MS = 2 * 60 * 1000;

/**
 * Holds the automatic sync off while this screen is the one in front of the collector (see
 * `holdAutoSync`). ON FOCUS, NOT ON MOUNT: the lease screen stays mounted under the receipt
 * screen and under the shift screen after a save, and a hold kept by a screen nobody is
 * looking at would stop the timer for the rest of the round.
 */
export function useHoldAutoSync(): void {
  useFocusEffect(useCallback(() => holdAutoSync(), []));
}
