import { useCallback, useEffect, useState } from "react";
import { useFocusEffect, useRouter } from "expo-router";
import { View } from "react-native";
import { formatSerial } from "@ceedo/shared";
import { receiptHistory, type HistoryDay, type HistoryRow } from "@ceedo/sync-engine";
import { Action, Body, Label, List, Note, RackHead, Register, Rift, Screen, Slot, Title, color } from "../ui";
import { fromWire } from "../ui/money";
import { clockTime, longDate } from "../ui/time";
import { freshness, type Freshness } from "../ui/staleness";
import { deviceDriver } from "../db/driver";
import { signedIn } from "../auth/session";
import { businessDate, onSyncSettled } from "../sync/device-sync";

const STATUS: Record<HistoryRow["status"], { said: string; tone: string }> = {
  waiting: { said: "Waiting to sync", tone: color.warning },
  synced: { said: "Synced", tone: color.confirmed },
  refused: { said: "Refused", tone: color.refusal },
  cancelled: { said: "Cancelled by office", tone: color.muted },
};

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

  const load = useCallback(async () => {
    if (!collector) return;
    const page = await receiptHistory(driver, collector.id);
    setDays(page.days);
    setNext(page.nextBeforeDate);
    setFresh(await freshness(driver, businessDate()));
    setLoaded(true);
  }, [collector, driver]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );
  useEffect(() => onSyncSettled(() => void load()), [load]);

  const older = async () => {
    if (!collector || !next) return;
    const page = await receiptHistory(driver, collector.id, { beforeDate: next });
    setDays((shown) => [...shown, ...page.days]);
    setNext(page.nextBeforeDate);
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
      {loaded && days.length === 0 ? (
        <Note icon="receipt-text-outline">
          No receipts yet. Sync from the shift screen to load your history.
        </Note>
      ) : null}

      {days.map((day) => (
        <View key={day.businessDate}>
          <Label>
            {`${longDate(day.businessDate)} · ${day.count} receipt${day.count === 1 ? "" : "s"} · ${
              fromWire(day.total) ?? "total unavailable"
            }`}
          </Label>
          <Rift h={8} />
          <List>
            {day.rows.map((row) => {
              const status = STATUS[row.status];
              const payer = row.stallNo
                ? `${row.stallNo}${row.tenantName ? ` · ${row.tenantName}` : ""}`
                : `${row.feeTypeName ?? "On-the-spot fee"}${row.quantity ? ` × ${row.quantity}` : ""}`;
              return (
                <Slot
                  key={row.id}
                  icon={row.stallNo ? "storefront-outline" : "cash-plus"}
                  suppressed={row.status === "cancelled"}
                  left={
                    <View style={{ gap: 2 }}>
                      <Title numberOfLines={1}>
                        {row.orNo !== null && row.serialPrefix
                          ? formatSerial(row.serialPrefix, row.orNo)
                          : `OR ${row.orNo ?? "?"}`}
                      </Title>
                      <Body>{payer}</Body>
                      <Body tone={color.muted}>{clockTime(row.collectedAt) ?? "No time recorded"}</Body>
                    </View>
                  }
                  right={fromWire(row.grossAmount) ?? "—"}
                  under={
                    <Body tone={status.tone}>
                      {row.detail ? `${status.said} · ${row.detail}` : status.said}
                    </Body>
                  }
                />
              );
            })}
          </List>
          <Rift h={20} />
        </View>
      ))}

      {next ? <Action label="Show older" icon="history" onPress={() => void older()} /> : null}
    </Screen>
  );
}
