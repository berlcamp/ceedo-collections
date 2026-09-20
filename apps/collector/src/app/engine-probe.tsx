import { useState } from "react";
import { randomUUID } from "expo-crypto";
import { Button, Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { useMigrations } from "drizzle-orm/expo-sqlite/migrator";
import { drizzle } from "drizzle-orm/expo-sqlite";
import migrations from "../../drizzle/migrations";
import { openDeviceDb } from "../db/client";
import { expoSqliteDriver } from "../db/driver";
import { applyPull, readSyncState, enqueue, pushable } from "@ceedo/sync-engine";

/**
 * SPEC E1's SECOND RULE: one on-device test runs the REAL engine against expo-sqlite.
 *
 * Everything in tests/device runs the engine against better-sqlite3, which is synchronous,
 * has different transaction semantics, and a different bound-parameter ceiling. That is the
 * same structural gap Phase 3a had between `postgres` and `ceedo_app`: the double is exempt
 * from things the real driver is not, and no amount of Node testing closes it.
 *
 * This screen is the local translation of "connect as authenticator". It stays in the app
 * after this task -- it costs one route and it is the only thing that will catch an
 * expo-sqlite behaviour change on an SDK upgrade.
 */
export default function EngineProbe() {
  const db = openDeviceDb();
  const { success, error } = useMigrations(drizzle(db), migrations);
  const [log, setLog] = useState<string[]>([]);
  const [running, setRunning] = useState(false);

  async function run() {
    setRunning(true);
    const out: string[] = [];
    try {
      const driver = expoSqliteDriver(db);
      await driver.execute(
        "insert or ignore into sync_state (id, cursor, epoch) values (1, 0, 0)",
      );

      // 1,500 rows: over BOTH SQLITE_MAX_VARIABLE_NUMBER ceilings when unchunked, so an
      // unchunked apply fails here on every build rather than only the unlucky ones.
      const rows = Array.from({ length: 1500 }, (_, i) => ({
        id: `probe-${i}`,
        lease_id: "probe-lease",
        amount: "100.00",
        row_version: i,
      }));
      await applyPull(driver, { cursor: 1500, epoch: 0, charges: rows });
      const counted = await driver.select<{ n: number }>(
        "select count(*) as n from charges",
      );
      out.push(`apply 1500 rows: ${counted[0]?.n} present`);
      out.push(`cursor: ${(await readSyncState(driver)).cursor}`);

      // The atomicity guarantee, on the real driver. A failing apply must leave the cursor
      // where it was.
      const before = (await readSyncState(driver)).cursor;
      try {
        await applyPull(driver, {
          cursor: 9999,
          epoch: 0,
          charges: [{ id: "bad", no_such_column: 1 }],
        });
        out.push("ATOMICITY FAILED: a bad apply did not throw");
      } catch {
        const after = (await readSyncState(driver)).cursor;
        out.push(
          after === before
            ? `atomicity: cursor held at ${after}`
            : `ATOMICITY FAILED: cursor moved ${before} -> ${after}`,
        );
      }

      // THE PROBE CLEANS UP AFTER ITSELF, and the first version of it did not.
      //
      // It left this entry in the REAL outbox with a payload that cannot satisfy
      // SpoiledFormPayload, so the next sync pushed it, the Edge Function answered
      // `400 invalid_body` for the whole body, and enrollment reported "the first sync
      // failed". The engine now quarantines an entry like that instead of retrying it
      // forever (quarantine.test.ts), but a diagnostic that leaves rubbish in the queue it
      // is diagnosing is wrong regardless of how well the queue copes.
      //
      // The payload is VALID now as well as temporary. A probe that can only be survived
      // because of a safety net is not testing the thing it appears to test.
      const probeId = randomUUID();
      await enqueue(driver, {
        id: probeId,
        type: "spoiled_form",
        payload: {
          booklet_id: randomUUID(),
          or_no: 1,
          collector_id: randomUUID(),
          reason: "Engine probe. Deleted before this screen returns.",
        },
        collectorId: probeId,
      });
      const queued = await pushable(driver);
      await driver.execute("delete from outbox where id = ?", [probeId]);
      const left = await pushable(driver);
      out.push(
        `outbox: ${queued.length} pushable with the probe entry, ` +
          `${left.length} after removing it`,
      );
    } catch (e) {
      out.push(`THREW: ${String(e)}`);
    }
    setLog(out);
    setRunning(false);
  }

  if (error) return <Text style={styles.body}>Migration error: {error.message}</Text>;
  if (!success) return <Text style={styles.body}>Migrating…</Text>;

  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <Text style={styles.body}>
        Runs the real sync engine against expo-sqlite: a 1,500-row apply, the E7 atomicity
        guarantee, and one outbox round. Any line reading ATOMICITY FAILED or THREW is a
        finding about the engine, not about this probe.
      </Text>

      <Button
        title={running ? "Running…" : "Run the engine against expo-sqlite"}
        onPress={run}
        disabled={running}
      />

      {log.length > 0 ? (
        <View style={styles.results}>
          {log.map((line, i) => (
            <Text key={`${i}-${line}`} selectable style={styles.mono}>
              {line}
            </Text>
          ))}
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { padding: 24, gap: 16 },
  body: { fontSize: 14, lineHeight: 20, color: "#475569" },
  results: { gap: 4, padding: 12, backgroundColor: "#0f172a", borderRadius: 8 },
  mono: {
    fontFamily: Platform.select({ android: "monospace", default: "Menlo" }),
    fontSize: 13,
    color: "#e2e8f0",
  },
});
