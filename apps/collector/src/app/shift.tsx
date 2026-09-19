import { useCallback, useState } from "react";
import { useFocusEffect, useRouter } from "expo-router";
import {
  ActivityIndicator,
  Button,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { deviceTotals, openShift, pushable, type OutboxRow } from "@ceedo/sync-engine";
import { openDeviceDb } from "../db/client";
import { expoSqliteDriver } from "../db/driver";
import { signedIn, signOut } from "../auth/session";
import { businessDate, syncNow } from "../sync/device-sync";

interface LocalShift {
  id: string;
  collector_id: string;
  business_date: string;
  opened_at: string;
  status: string;
}

/**
 * The shift a collector works in. Phase 3b-i's shift contains zero receipts by design --
 * the collection flow is 3b-ii -- so this screen is the spine: open, sync, close out.
 */
export default function Shift() {
  const router = useRouter();
  const driver = expoSqliteDriver(openDeviceDb());
  const collector = signedIn();

  const [shift, setShift] = useState<LocalShift | null>(null);
  const [totals, setTotals] = useState({ count: 0, total: "0.00" });
  const [queued, setQueued] = useState<OutboxRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!collector) return;
    const rows = await driver.select<LocalShift>(
      `select id, collector_id, business_date, opened_at, status
         from local_shifts
        where collector_id = ? and status = 'open'
        order by opened_at desc`,
      [collector.id],
    );
    const mine = rows[0] ?? null;
    setShift(mine);
    setTotals(mine ? await deviceTotals(driver, mine.id) : { count: 0, total: "0.00" });
    setQueued(await pushable(driver));
  }, [collector, driver]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  if (!collector) {
    return (
      <View style={styles.screen}>
        <Text style={styles.body}>Not signed in.</Text>
        <Button title="Go to sign-in" onPress={() => router.replace("/sign-in")} />
      </View>
    );
  }

  // §6.5 step 1: "force sync; outbox must reach zero pending". Enforced here rather than
  // assumed, because a closeout pushed while receipts are still queued compares the
  // device's figures against a server that has not seen them yet -- and answers `mismatch`
  // for a shift that is in fact perfectly balanced.
  const blocked = queued.length > 0;

  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <Text style={styles.heading}>{collector.full_name ?? collector.id}</Text>
      <Text style={styles.body}>Business date {businessDate()}</Text>

      {shift ? (
        <View style={styles.card}>
          <Text style={styles.body}>Shift open since {shift.opened_at}</Text>
          <Text style={styles.figure}>
            {totals.count} receipt{totals.count === 1 ? "" : "s"} · ₱{totals.total}
          </Text>
        </View>
      ) : (
        <Text style={styles.body}>No shift is open on this tablet for you.</Text>
      )}

      {blocked ? (
        <Text style={styles.warn}>
          {queued.length} entr{queued.length === 1 ? "y" : "ies"} still waiting to reach the
          server. Sync before closing out — a closeout sent now would be compared against a
          server that has not seen them.
        </Text>
      ) : null}

      <Button
        title={busy ? "Syncing…" : "Sync now"}
        disabled={busy}
        onPress={async () => {
          setBusy(true);
          setMessage(null);
          try {
            const outcome = await syncNow();
            setMessage(
              `Synced${outcome.fullResync ? " (full re-sync)" : ""}. ` +
                `${outcome.pushed} entr${outcome.pushed === 1 ? "y" : "ies"} pushed.`,
            );
          } catch (error) {
            // Never fatal. A collector with no signal keeps working offline; that is the
            // whole design (parent §3).
            setMessage(`Could not sync: ${String(error)}. You can keep working offline.`);
          } finally {
            setBusy(false);
            await load();
          }
        }}
      />

      {shift ? (
        <Button
          title="Close out"
          disabled={busy || blocked}
          onPress={() => router.push({ pathname: "/closeout", params: { shiftId: shift.id } })}
        />
      ) : (
        <Button
          title="Open a shift"
          disabled={busy}
          onPress={async () => {
            setBusy(true);
            try {
              await openShift(driver, {
                collectorId: collector.id,
                businessDate: businessDate(),
              });
            } finally {
              setBusy(false);
              await load();
            }
          }}
        />
      )}

      <Button
        title="Sign out"
        onPress={() => {
          // Clears a session, never data (parent §6.4). The outbox and every local shift
          // stay exactly where they are.
          signOut();
          router.replace("/sign-in");
        }}
      />

      {busy ? <ActivityIndicator /> : null}
      {message ? <Text style={styles.body}>{message}</Text> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { padding: 24, gap: 12 },
  heading: { fontSize: 20, fontWeight: "600", color: "#0f172a" },
  body: { fontSize: 14, lineHeight: 20, color: "#475569" },
  figure: { fontSize: 22, fontWeight: "600", color: "#0f172a" },
  card: {
    padding: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    backgroundColor: "#f8fafc",
    gap: 6,
  },
  warn: { fontSize: 13, lineHeight: 18, color: "#92400e" },
});
