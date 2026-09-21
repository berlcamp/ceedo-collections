import { useCallback, useState } from "react";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { Button, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import {
  format,
  fromCentavos,
  parsePesoInput,
  selectByAmount,
  sum,
  type Centavos,
  type PeriodGroup,
} from "@ceedo/shared";
import { leaseLedgerDetail, ledgerStaleness } from "@ceedo/sync-engine";
import { openDeviceDb } from "../../db/client";
import { expoSqliteDriver } from "../../db/driver";
import { setDraft } from "../../collect/draft";
import { businessDate, syncNow } from "../../sync/device-sync";

interface Header {
  stall_no: string;
  tenant_name: string;
  // `leases` carries no fee_type_id column -- migration 20260917000004_tenants_leases.sql
  // never gave it one, and only `charges` does (20260918000011_ledger_charges.sql). Every
  // charge on a lease is stamped from that lease's one rate, so any of its charges names
  // the right fee type; a lease with none yet (nothing accrued) reports null here, and
  // that lease also has no outstanding groups, so the button below never needs it.
  fee_type_id: string | null;
}

/**
 * What this tenant owes, oldest first, and the two ways to choose how much of it is being
 * paid. Spec F6.
 *
 * BOTH MODES PRODUCE ONE ARTEFACT: a set of ranks 1..n. Tapping the fifth row selects one
 * through five; typing a peso figure runs selectByAmount. The payload, the validation and
 * the server path are then identical, so the second mode is a second way in rather than a
 * second code path to the wire.
 *
 * THE STALENESS LINE IS NOT DECORATION (spec F7). The collector writes the paper OR by
 * hand from the figure on this screen, and the paper is what the tenant walks away
 * holding. If another tablet settled a group since this device last pulled, the ranks name
 * different periods than were quoted and the amount recorded will differ from the cash
 * taken. The device cannot detect that -- it is caught at closeout, which blocks -- so what
 * this screen owes is an honest statement of how old its numbers are.
 */
export default function Lease() {
  const { leaseId } = useLocalSearchParams<{ leaseId: string }>();
  const router = useRouter();
  const driver = expoSqliteDriver(openDeviceDb());

  const [header, setHeader] = useState<Header | null>(null);
  const [groups, setGroups] = useState<PeriodGroup[]>([]);
  const [perCharge, setPerCharge] = useState<Map<string, Centavos>>(new Map());
  const [ranks, setRanks] = useState<number[]>([]);
  const [tendered, setTendered] = useState("");
  const [stale, setStale] = useState<{ lastFullSyncDate: string | null; pendingCount: number }>({
    lastFullSyncDate: null,
    pendingCount: 0,
  });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const rows = await driver.select<Header>(
      `select s.stall_no, t.full_name as tenant_name,
              (select c.fee_type_id from charges c where c.lease_id = l.id limit 1)
                as fee_type_id
         from leases l
         join stalls s on s.id = l.stall_id
         join tenants t on t.id = l.tenant_id
        where l.id = ?`,
      [leaseId],
    );
    setHeader(rows[0] ?? null);
    const detail = await leaseLedgerDetail(driver, leaseId);
    setGroups(detail.groups);
    setPerCharge(detail.perCharge);
    setStale(await ledgerStaleness(driver));
  }, [driver, leaseId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const selected = groups.filter((g) => ranks.includes(g.groupRank));
  const gross = sum(selected.map((g) => g.outstanding));
  const balance = sum(groups.map((g) => g.outstanding));

  /** Tapping row n selects rows 1..n. FIFO is enforced by construction (parent §8.3). */
  const tapRow = (rank: number) => {
    setTendered("");
    setRanks(ranks.length === rank ? [] : Array.from({ length: rank }, (_, i) => i + 1));
  };

  const applyAmount = (text: string) => {
    setTendered(text);
    if (text.trim() === "") return setRanks([]);
    let cash: Centavos;
    try {
      cash = parsePesoInput(text);
    } catch {
      return setRanks([]);
    }
    setRanks(selectByAmount(groups, cash).selected.map((g) => g.groupRank));
  };

  // Parsed once, so the "does not cover" message below can show the SAME figure `change`
  // is computed from rather than re-parsing `tendered` a second time unguarded. A
  // half-typed decimal ("." on the decimal pad, before the digits after it land) fails
  // parsePesoInput -- Number(".") is NaN -- and re-parsing it in the render, rather than
  // reusing this guarded value, would crash the screen mid-keystroke instead of just
  // waiting for a valid figure.
  const tenderedCentavos = (() => {
    if (tendered.trim() === "") return null;
    try {
      return parsePesoInput(tendered);
    } catch {
      return null;
    }
  })();

  const change =
    tenderedCentavos === null ? fromCentavos(0) : fromCentavos(tenderedCentavos - gross);

  const shortOfOldest = tenderedCentavos !== null && ranks.length === 0 && groups.length > 0;

  if (!header) return <Text style={styles.note}>This lease is not on this tablet.</Text>;

  // See the Header comment: a lease with any outstanding group necessarily has at least
  // one charge, so fee_type_id is only null when groups is empty and the button below is
  // disabled anyway. Read once here so the onPress closure below is typed non-null.
  const feeTypeId = header.fee_type_id;

  return (
    <ScrollView style={styles.screen}>
      <Text style={styles.stall}>{header.stall_no}</Text>
      <Text style={styles.tenant}>{header.tenant_name}</Text>
      <Text style={styles.balance}>Balance {format(balance)}</Text>

      <View style={styles.stale}>
        <Text style={styles.staleText}>
          {stale.lastFullSyncDate === null
            ? "This tablet has never completed a full sync. These figures may be wrong."
            : stale.lastFullSyncDate === businessDate()
              ? "Synced today."
              : `Last full sync ${stale.lastFullSyncDate}. Another tablet may have collected since.`}
          {stale.pendingCount > 0 ? ` ${stale.pendingCount} receipt(s) still queued.` : ""}
        </Text>
        <Button
          title="Sync now"
          disabled={busy}
          onPress={async () => {
            setBusy(true);
            try {
              await syncNow();
              await load();
              setRanks([]);
              setTendered("");
            } finally {
              setBusy(false);
            }
          }}
        />
      </View>

      {groups.length === 0 ? (
        <Text style={styles.note}>Nothing outstanding.</Text>
      ) : (
        groups.map((group) => (
          <Pressable
            key={group.groupRank}
            style={[styles.period, ranks.includes(group.groupRank) && styles.periodOn]}
            onPress={() => tapRow(group.groupRank)}
          >
            <Text style={styles.periodText}>
              {group.periodStart} · due {group.dueDate}
            </Text>
            <Text style={styles.periodAmount}>{format(group.outstanding)}</Text>
          </Pressable>
        ))
      )}

      <Text style={styles.label}>Or enter what the tenant is handing over</Text>
      <TextInput
        style={styles.input}
        keyboardType="decimal-pad"
        placeholder="0.00"
        value={tendered}
        onChangeText={applyAmount}
      />

      {shortOfOldest && tenderedCentavos !== null ? (
        <Text style={styles.warn}>
          {format(tenderedCentavos)} does not cover the oldest period
          ({format(groups[0]!.outstanding)}). Whole periods only — there is no part payment.
        </Text>
      ) : null}

      <Text style={styles.total}>Receipt total {format(gross)}</Text>
      {change > 0 ? <Text style={styles.change}>Change {format(change)}</Text> : null}

      <Button
        title="Proceed to payment"
        disabled={ranks.length === 0 || feeTypeId === null}
        onPress={() => {
          if (feeTypeId === null) return;
          setDraft({
            kind: "lease",
            leaseId,
            feeTypeId,
            stallNo: header.stall_no,
            tenantName: header.tenant_name,
            groups,
            ranks,
            // Per CHARGE, not per group: local_allocations is keyed
            // (collection_id, charge_id) so Task 4's overlay subtracts exactly what was
            // settled. perCharge comes from leaseLedgerDetail, the same read that
            // produced these groups, so the two cannot disagree.
            allocations: selected.flatMap((g) =>
              g.chargeIds.map((chargeId) => ({
                chargeId,
                amount: perCharge.get(chargeId) ?? fromCentavos(0),
              })),
            ),
            grossAmount: gross,
            change,
          });
          router.push("/receipt");
        }}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: 16 },
  stall: { fontSize: 30, fontWeight: "800" },
  tenant: { fontSize: 18 },
  balance: { fontSize: 18, marginTop: 6, marginBottom: 12 },
  stale: { backgroundColor: "#fff8e1", padding: 10, borderRadius: 6, marginBottom: 12, gap: 6 },
  staleText: { fontSize: 13 },
  period: { flexDirection: "row", justifyContent: "space-between", padding: 14, borderBottomWidth: 1, borderBottomColor: "#eee" },
  periodOn: { backgroundColor: "#e3f2fd" },
  periodText: { fontSize: 15 },
  periodAmount: { fontSize: 15, fontWeight: "600" },
  label: { marginTop: 16, fontSize: 14, color: "#666" },
  input: { borderWidth: 1, borderColor: "#999", borderRadius: 6, padding: 12, fontSize: 22 },
  warn: { marginTop: 8, color: "#b71c1c", fontSize: 14 },
  total: { marginTop: 16, fontSize: 22, fontWeight: "700" },
  change: { fontSize: 18, color: "#1b5e20" },
  note: { padding: 16, fontSize: 15, color: "#666" },
});
