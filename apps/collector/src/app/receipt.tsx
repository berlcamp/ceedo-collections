import { useCallback, useEffect, useState } from "react";
import { useRouter } from "expo-router";
import { Button, StyleSheet, Text, TextInput, View } from "react-native";
import { randomUUID } from "expo-crypto";
import {
  format,
  formatSerial,
  validateOrEntry,
  type OrEntryContext,
  type OrEntryResult,
} from "@ceedo/shared";
import { commitReceipt, orEntryContext } from "@ceedo/sync-engine";
import { openDeviceDb } from "../db/client";
import { expoSqliteDriver } from "../db/driver";
import { signedIn } from "../auth/session";
import { clearDraft, draft } from "../collect/draft";

/**
 * The OR number goes in AFTER the money is counted and the paper receipt is written.
 *
 * There is no printer. The receipts are pre-printed accountable forms the collector
 * carries; the app records a number that already exists on paper in the tenant's hand
 * (spec §1.2). So this screen's job is to validate a serial, not to issue one.
 *
 * A SEQUENCE SKIP IS A WARNING THE COLLECTOR CAN ACCEPT, never a block: parent §7.1 says
 * booklets legitimately get skipped, and a warning that fires on correct behaviour is one
 * that gets ignored on the day it is right. `ambiguous_booklet` IS a hard stop, because a
 * silently wrong booklet id on a real receipt is unrecoverable once the vendor walks away.
 */
export default function Receipt() {
  const router = useRouter();
  const driver = expoSqliteDriver(openDeviceDb());
  const collector = signedIn();
  const pending = draft();

  const [context, setContext] = useState<OrEntryContext | null>(null);
  const [orText, setOrText] = useState("");
  const [check, setCheck] = useState<OrEntryResult | null>(null);
  const [acceptedSkip, setAcceptedSkip] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!collector) return;
    void orEntryContext(driver, collector.id).then(setContext);
  }, [collector, driver]);

  const validate = useCallback(
    (text: string) => {
      setOrText(text);
      setAcceptedSkip(false);
      const orNo = Number.parseInt(text, 10);
      if (!context || !Number.isInteger(orNo) || orNo <= 0) return setCheck(null);
      setCheck(validateOrEntry(context, orNo));
    },
    [context],
  );

  if (!collector) return <Text style={styles.note}>Sign in first.</Text>;
  if (!pending) return <Text style={styles.note}>Nothing to record. Start from the shift screen.</Text>;

  const reason = (result: OrEntryResult): string => {
    if (result.ok) return "";
    switch (result.reason) {
      case "not_in_assigned_booklet":
        return "That number is not inside any booklet assigned to you.";
      case "already_consumed":
        return "That number has already been used.";
      case "marked_spoiled":
        return "That number is marked spoiled.";
      case "ambiguous_booklet":
        return "That number falls inside two of your booklets. Check the form type before writing it.";
    }
  };

  // A lookup that tolerates a miss, rather than the two non-null assertions the brief's
  // draft used. When check.ok is true, its bookletId did come from context.booklets --
  // but the compiler cannot see that connection through state, and asserting it twice in
  // a render path is exactly how a crash gets written later. If this ever fails to find a
  // match (it should not), the screen just withholds the confirmation line instead of
  // throwing -- the Record button is still gated on `check.ok`, not on this lookup.
  const matchedBooklet =
    check?.ok ? context?.booklets.find((b) => b.id === check.bookletId) : undefined;

  const blocked =
    check === null ||
    !check.ok ||
    (check.warning === "sequence_skipped" && !acceptedSkip);

  return (
    <View style={styles.screen}>
      <Text style={styles.heading}>
        {pending.kind === "lease" ? `${pending.stallNo} · ${pending.tenantName}` : pending.label}
      </Text>
      <Text style={styles.amount}>{format(pending.grossAmount)}</Text>
      {pending.kind === "lease" && pending.change > 0 ? (
        <Text style={styles.change}>Change {format(pending.change)}</Text>
      ) : null}

      <Text style={styles.label}>Write the receipt, then enter its number</Text>
      <TextInput
        style={styles.input}
        keyboardType="number-pad"
        placeholder="OR number"
        value={orText}
        onChangeText={validate}
      />

      {check && !check.ok ? <Text style={styles.error}>{reason(check)}</Text> : null}
      {check?.ok && matchedBooklet ? (
        <Text style={styles.ok}>
          {formatSerial(matchedBooklet.serialPrefix, Number.parseInt(orText, 10))}
        </Text>
      ) : null}
      {check?.ok && check.warning === "sequence_skipped" && !acceptedSkip ? (
        <View style={styles.warnBox}>
          <Text style={styles.warn}>
            This skips one or more numbers in the booklet. That is allowed — confirm it is
            what the paper shows.
          </Text>
          <Button title="Yes, that is the number written" onPress={() => setAcceptedSkip(true)} />
        </View>
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Button
        title="Record this receipt"
        disabled={blocked || busy}
        onPress={async () => {
          if (!check?.ok) return;
          setBusy(true);
          setError(null);
          try {
            const shifts = await driver.select<{ id: string }>(
              "select id from local_shifts where collector_id = ? and status = 'open' order by opened_at desc",
              [collector.id],
            );
            const shiftId = shifts[0]?.id;
            if (!shiftId) {
              setError("This shift is no longer open. Open one from the shift screen.");
              return;
            }

            await commitReceipt(
              driver,
              {
                id: randomUUID(),
                orNo: Number.parseInt(orText, 10),
                bookletId: check.bookletId,
                collectorId: collector.id,
                shiftId,
                collectedAt: new Date().toISOString(),
                feeTypeId: pending.feeTypeId,
                leaseId: pending.kind === "lease" ? pending.leaseId : null,
                grossAmount: pending.grossAmount,
                ranks: pending.kind === "lease" ? pending.ranks : [],
                allocations: pending.kind === "lease" ? pending.allocations : [],
                lines: pending.kind === "lines" ? pending.lines : [],
                payerRef: null,
                notes: null,
              },
              pending.kind === "lines" ? pending.lines.map(() => randomUUID()) : [],
            );

            clearDraft();
            router.replace("/shift");
          } catch (caught) {
            // Nothing was written -- commitReceipt is one transaction. Saying so matters:
            // the collector needs to know whether to write another paper receipt.
            setError(`Not recorded, and nothing was saved: ${String(caught)}`);
          } finally {
            setBusy(false);
          }
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: 16, gap: 10 },
  heading: { fontSize: 20, fontWeight: "700" },
  amount: { fontSize: 34, fontWeight: "800" },
  change: { fontSize: 18, color: "#1b5e20" },
  label: { marginTop: 12, fontSize: 14, color: "#666" },
  input: { borderWidth: 1, borderColor: "#999", borderRadius: 6, padding: 12, fontSize: 24 },
  ok: { fontSize: 18, color: "#1b5e20", fontWeight: "600" },
  error: { color: "#b71c1c", fontSize: 15 },
  warnBox: { backgroundColor: "#fff8e1", padding: 10, borderRadius: 6, gap: 8 },
  warn: { fontSize: 14 },
  note: { padding: 16, fontSize: 15, color: "#666" },
});
