import { useCallback, useEffect, useRef, useState } from "react";
import { useFocusEffect, useRouter } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import { formatSerial } from "@ceedo/shared";
import { receiptHistory, type HistoryDay, type HistoryRow } from "@ceedo/sync-engine";
import { Action, Note, RackHead, Register, Rift, Screen, color, face, radius, size, space } from "../ui";
import { fromWire } from "../ui/money";
import { clockTime, longDate } from "../ui/time";
import { freshness, type Freshness } from "../ui/staleness";
import { deviceDriver } from "../db/driver";
import { signedIn } from "../auth/session";
import { businessDate, onSyncSettled } from "../sync/device-sync";

// Short enough for one table cell; a refusal or cancellation reason gets its own line.
const STATUS: Record<HistoryRow["status"], { said: string; tone: string }> = {
  waiting: { said: "Waiting to sync", tone: color.warning },
  synced: { said: "Synced", tone: color.confirmed },
  refused: { said: "Refused", tone: color.refusal },
  cancelled: { said: "Cancelled", tone: color.muted },
};

const PAGE_DAYS = 14; // receiptHistory's default page

const READ_FAILED = "Could not load your history from this tablet. Go back and open it again.";
const OLDER_FAILED = "Could not load older receipts from this tablet. Try Show older again.";

/**
 * Every receipt the signed-in collector has, newest first, a business day at a time.
 *
 * READS ONLY THIS TABLET. The server's history arrives by ordinary sync (sync_pull sends
 * each collector's own receipts, migration 0061), so this screen works with no signal and
 * is as fresh as the Register in the bar says.
 */
export default function History() {
  const router = useRouter();
  const driver = deviceDriver();
  const collector = signedIn();

  const [days, setDays] = useState<HistoryDay[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [fresh, setFresh] = useState<Freshness | null>(null);
  // A failed read of this tablet's own database. Shown in place of the empty state, which
  // would otherwise claim "no receipts" about a history that could not be read.
  const [failed, setFailed] = useState<string | null>(null);

  // How many business days are on screen, and which request is the newest. A reload re-reads
  // the WHOLE depth the collector has paged to (a sync must not throw their place away), and
  // a request that finds a newer one has started drops its result instead of overwriting it.
  const shown = useRef(PAGE_DAYS);
  const latest = useRef(0);
  const paging = useRef(false);

  const load = useCallback(async () => {
    if (!collector) return;
    const mine = ++latest.current;
    try {
      const page = await receiptHistory(driver, collector.id, {
        days: Math.max(PAGE_DAYS, shown.current),
      });
      if (mine !== latest.current) return;
      shown.current = page.days.length;
      setDays(page.days);
      setNext(page.nextBeforeDate);
      setFailed(null);
    } catch {
      if (mine === latest.current) setFailed(READ_FAILED);
    } finally {
      // Loaded either way, so the screen never sits blank waiting on a read that is over.
      if (mine === latest.current) setLoaded(true);
    }
    // The sync age in the bar is separate: failing to read it must not hide the receipts,
    // and the bar simply keeps its last age (or shows none).
    try {
      const stamp = await freshness(driver, businessDate());
      if (mine === latest.current) setFresh(stamp);
    } catch {
      // Nothing to show; the receipts above are still right.
    }
  }, [collector, driver]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );
  useEffect(() => onSyncSettled(() => void load()), [load]);

  const older = async () => {
    if (!collector || !next || paging.current) return;
    paging.current = true;
    const mine = ++latest.current;
    try {
      const page = await receiptHistory(driver, collector.id, { beforeDate: next });
      if (mine !== latest.current) return;
      shown.current += page.days.length;
      setDays((now) => [...now, ...page.days]);
      setNext(page.nextBeforeDate);
      setFailed(null);
    } catch {
      if (mine === latest.current) setFailed(OLDER_FAILED);
    } finally {
      paging.current = false;
    }
  };

  if (!collector) {
    return (
      <Screen head={<RackHead title="Transaction history" onBack={() => router.back()} />}>
        <Note>Sign in first.</Note>
      </Screen>
    );
  }

  return (
    <Screen
      head={
        <RackHead
          title="Transaction history"
          subtitle={collector.full_name ?? undefined}
          onBack={() => router.back()}
          register={fresh ? <Register state={fresh.state} detail={fresh.short} /> : undefined}
        />
      }
    >
      {failed && days.length === 0 ? <Note icon="alert-circle-outline">{failed}</Note> : null}

      {loaded && !failed && days.length === 0 ? (
        <Note icon="receipt-text-outline">
          No receipts yet. Sync from the shift screen to load your history.
        </Note>
      ) : null}

      {days.map((day) => (
        <View key={day.businessDate}>
          <View style={s.table}>
            <View style={s.dayBar}>
              <Text style={s.dayDate} numberOfLines={1}>
                {longDate(day.businessDate)}
              </Text>
              <Text style={s.dayTotal} numberOfLines={1}>
                {`${day.count} receipt${day.count === 1 ? "" : "s"} · ${
                  fromWire(day.total) ?? "total unavailable"
                }`}
              </Text>
            </View>
            <View style={[s.row, s.headRow]}>
              <Text style={[s.head, s.time]}>Time</Text>
              <Text style={[s.head, s.or]}>OR no.</Text>
              <Text style={[s.head, s.payer]}>Paid by</Text>
              <Text style={[s.head, s.amount]}>Amount</Text>
              <Text style={[s.head, s.status]}>Status</Text>
            </View>
            {day.rows.map((row, index) => {
              const status = STATUS[row.status];
              const cancelled = row.status === "cancelled";
              const ink = cancelled ? color.suppressed : color.ink;
              const payer = row.stallNo
                ? `${row.stallNo}${row.tenantName ? ` · ${row.tenantName}` : ""}`
                : `${row.feeTypeName ?? "On-the-spot fee"}${row.quantity ? ` × ${row.quantity}` : ""}`;
              return (
                <View key={row.id} style={[s.entry, index % 2 === 1 && s.zebra]}>
                  <View style={s.row}>
                    <Text style={[s.cell, s.time, { color: color.muted }]} numberOfLines={1}>
                      {clockTime(row.collectedAt) ?? "—"}
                    </Text>
                    <Text style={[s.cell, s.or, s.strong, { color: ink }]} numberOfLines={1}>
                      {row.orNo !== null && row.serialPrefix
                        ? formatSerial(row.serialPrefix, row.orNo)
                        : `OR ${row.orNo ?? "?"}`}
                    </Text>
                    <Text style={[s.cell, s.payer, { color: ink }]} numberOfLines={1}>
                      {payer}
                    </Text>
                    <Text
                      style={[
                        s.cell,
                        s.amount,
                        s.strong,
                        { color: ink },
                        cancelled && s.struck,
                      ]}
                      numberOfLines={1}
                    >
                      {fromWire(row.grossAmount) ?? "—"}
                    </Text>
                    <View style={[s.status, s.statusCell]}>
                      <View style={[s.dot, { backgroundColor: status.tone }]} />
                      <Text style={[s.cell, { color: status.tone }]} numberOfLines={1}>
                        {status.said}
                      </Text>
                    </View>
                  </View>
                  {row.detail ? (
                    <Text style={[s.detail, { color: status.tone }]} numberOfLines={2}>
                      {row.detail}
                    </Text>
                  ) : null}
                </View>
              );
            })}
          </View>
          <Rift h={space.step} />
        </View>
      ))}

      {failed && days.length > 0 ? (
        <>
          <Note>{failed}</Note>
          <Rift h={12} />
        </>
      ) : null}

      {next ? <Action label="Show older" icon="history" onPress={() => void older()} /> : null}
    </Screen>
  );
}

// A dense ledger: one line per receipt, so a full day fits on screen. Column widths are
// fixed for the short fields and flexible for the payer, which truncates rather than wraps.
const s = StyleSheet.create({
  table: {
    backgroundColor: color.card,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: color.rule,
    overflow: "hidden",
  },
  dayBar: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: space.snug,
    paddingHorizontal: space.snug,
    paddingVertical: space.tight + 2,
    backgroundColor: color.hero,
  },
  dayDate: { fontFamily: face.bold, fontSize: size.small, color: color.onHero, flexShrink: 1 },
  dayTotal: { fontFamily: face.bold, fontSize: size.small, color: color.onHeroMuted },
  headRow: {
    backgroundColor: color.sunk,
    paddingVertical: space.tight - 2,
    borderBottomWidth: 1,
    borderBottomColor: color.rule,
  },
  head: {
    fontFamily: face.bold,
    fontSize: size.label - 1,
    color: color.muted,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  entry: {
    paddingVertical: space.tight,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.rule,
  },
  zebra: { backgroundColor: color.ground },
  row: { flexDirection: "row", alignItems: "center", gap: space.tight, paddingHorizontal: space.snug },
  cell: { fontFamily: face.text, fontSize: size.label, color: color.ink },
  strong: { fontFamily: face.bold },
  struck: { textDecorationLine: "line-through" },
  time: { width: 64 },
  or: { width: 112 },
  payer: { flex: 1, minWidth: 0 },
  amount: { width: 92, textAlign: "right", fontVariant: ["tabular-nums"] },
  status: { width: 128 },
  statusCell: { flexDirection: "row", alignItems: "center", gap: 5 },
  dot: { width: 7, height: 7, borderRadius: radius.pill },
  detail: {
    fontFamily: face.text,
    fontSize: size.label - 1,
    paddingLeft: space.snug + 64 + space.tight,
    paddingRight: space.snug,
    paddingTop: 2,
  },
});
