import { useCallback, useEffect, useState } from "react";
import { useFocusEffect } from "expo-router";
import { SyncError, unsentCount } from "@ceedo/sync-engine";
import { deviceDriver } from "../db/driver";
import { syncFailure } from "../ui/failures";
import { lastSync, onSyncSettled, type SyncSettled } from "./device-sync";

/**
 * What the collector needs to know about sync without having pressed anything: how many
 * receipts exist only on this tablet, and whether the office has stopped accepting it.
 *
 * REFUSED IS KEPT, EVERY OTHER FAILURE IS NOT. An automatic sync that found no signal says
 * nothing -- the next one will try again. A 401 is different: the office answered and turned
 * this tablet's credential down, no retry will change that, and a tablet that quietly keeps
 * trying would let a collector take a full round of receipts that can never be sent.
 */
export function useSyncHealth(): {
  unsent: number | null;
  refused: { said: string; detail: string } | null;
} {
  const [unsent, setUnsent] = useState<number | null>(null);
  const [refused, setRefused] = useState(() => refusal(lastSync()));

  const count = useCallback(async () => {
    try {
      setUnsent(await unsentCount(deviceDriver()));
    } catch {
      // A count that cannot be read is shown as nothing rather than as zero.
      setUnsent(null);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void count();
    }, [count]),
  );

  useEffect(
    () =>
      onSyncSettled((result) => {
        setRefused(refusal(result));
        void count();
      }),
    [count],
  );

  return { unsent, refused };
}

/** The wording is syncFailure()'s, so this notice and a button's failure say the same thing. */
function refusal(result: SyncSettled | null): { said: string; detail: string } | null {
  if (result === null || result.ok) return null;
  if (!(result.error instanceof SyncError) || result.error.status !== 401) return null;
  return syncFailure(result.error);
}
