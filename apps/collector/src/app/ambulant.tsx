import { useCallback, useState } from "react";
import { useFocusEffect, useRouter } from "expo-router";
import { Button, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import {
  format,
  multiply,
  parsePesoInput,
  resolveRate,
  RateNotFoundError,
  sum,
  type RateRow,
} from "@ceedo/shared";
import type { DraftLine } from "@ceedo/sync-engine";
import { deviceDriver } from "../db/driver";
import { setDraft } from "../collect/draft";
import { businessDate, syncNow } from "../sync/device-sync";

interface FeeChoice {
  fee_type_id: string;
  fee_name: string;
  rate_class: string | null;
}

/**
 * On-the-spot fees: quantity x rate, no lease and no receivable. Parent §2's ambulant /
 * daily vendor fee, and the same shape Phase 5's terminal and slaughterhouse receipts need
 * -- which is why it is built here rather than deferred with them.
 *
 * Leaving it out would not defer the work. It would move half the round onto paper, and
 * the device's consumed-serial set would then diverge from the booklet it validates
 * against, so honest receipts would start raising sequence-skip warnings.
 *
 * resolveRate THROWS rather than choosing when two rates overlap. Here that becomes a
 * refusal the collector can read and a supervisor can act on -- never a crash at a stall.
 * The rates are stale-able local data, and a tablet that has not pulled a new ordinance's
 * rate row must say so rather than price the receipt itself.
 *
 * RateRow.rateClass is `string`, never null -- "" means unclassified (rates.ts:14). The
 * `rates` column IS nullable, so the load below normalises with `?? ""` when mapping rows
 * out of SQLite. DraftLine.rateClass, by contrast, is `string | null`, and the wire cares
 * about the difference: CollectionPayload's `rate_class` is optional, not nullable, and
 * commitReceipt omits the key entirely for `null` but would send a real (wrong) empty-
 * string rate class for "". So a picked fee's `rate_class` -- read straight off the nullable
 * SQLite column, never re-normalised -- is what flows into every DraftLine here.
 */
export default function Ambulant() {
  const router = useRouter();
  const driver = deviceDriver();

  const [choices, setChoices] = useState<FeeChoice[]>([]);
  const [rates, setRates] = useState<RateRow[]>([]);
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [pick, setPick] = useState<FeeChoice | null>(null);
  const [qty, setQty] = useState("1");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    // Non-accruing fee types only: an accruing one raises charges and belongs on a lease.
    // fee_types.accrues / .active are integer-mode booleans in SQLite, hence `= 0` / `= 1`.
    setChoices(
      await driver.select<FeeChoice>(
        `select distinct f.id as fee_type_id, f.name as fee_name, r.rate_class
           from fee_types f
           join rates r on r.fee_type_id = f.id
          where f.accrues = 0 and f.active = 1
          order by f.name, r.rate_class`,
      ),
    );
    setRates(
      (
        await driver.select<{
          id: string;
          fee_type_id: string;
          rate_class: string | null;
          effective_from: string;
          effective_to: string | null;
          amount: string;
          basis: RateRow["basis"];
        }>(
          "select id, fee_type_id, rate_class, effective_from, effective_to, amount, basis from rates",
        )
      ).map((r) => ({
        id: r.id,
        feeTypeId: r.fee_type_id,
        rateClass: r.rate_class ?? "",
        effectiveFrom: r.effective_from,
        effectiveTo: r.effective_to,
        amount: parsePesoInput(r.amount),
        basis: r.basis,
      })),
    );
  }, [driver]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const gross = sum(lines.map((l) => l.amount));

  // One fee type per receipt (review R12). parent §10's Abstract of Collections totals by
  // fee type off the collections row, and this screen's own `choices` query is not scoped
  // to one fee type -- it offers every non-accruing fee active on the tablet -- so nothing
  // upstream stops a collector tapping a different fee between "Add to receipt" presses.
  // Locking here, once the first line exists, is what makes that true rather than assumed.
  // A vehicle class (parent §2, Phase 5's terminal receipt) is a `rate_class` of ONE fee
  // type, so this still allows several classes of the SAME fee on one receipt -- only a
  // second fee type is refused.
  const lockedFeeTypeId = lines.length > 0 ? lines[0]!.feeTypeId : null;
  const lockedFeeName =
    lockedFeeTypeId === null
      ? null
      : (choices.find((c) => c.fee_type_id === lockedFeeTypeId)?.fee_name ?? lockedFeeTypeId);

  const addLine = () => {
    if (!pick) return;
    // Strict digit-string check, not just Number.parseInt: parseInt("3abc", 10) returns 3,
    // which would silently accept a mistyped quantity instead of rejecting it -- and no
    // partial input here may throw either, so this never touches Number() on garbage.
    const trimmed = qty.trim();
    const quantity = Number(trimmed);
    if (!/^\d+$/.test(trimmed) || !Number.isInteger(quantity) || quantity <= 0) {
      return setError("Quantity must be a whole number greater than zero.");
    }
    const named = `${pick.fee_name}${pick.rate_class ? ` (${pick.rate_class})` : ""}`;
    try {
      const rate = resolveRate(rates, pick.fee_type_id, businessDate(), pick.rate_class ?? "");
      setLines([
        ...lines,
        {
          feeTypeId: pick.fee_type_id,
          rateClass: pick.rate_class,
          quantity,
          unitRate: rate.amount,
          amount: multiply(rate.amount, quantity),
        },
      ]);
      setError(null);
      setQty("1");
    } catch (caught) {
      // Named precisely -- fee type, class, and date, for BOTH failure modes. "Not synced"
      // would be a guess, and 3b-i's device-found bug is what happens when a screen names a
      // cause it has not checked. The ambiguous-rates Error from resolveRate names only the
      // raw fee type id and date, not the class or a human name, so it is wrapped rather
      // than shown as-is; the raw message is kept in parentheses for whoever has to fix it.
      setError(
        caught instanceof RateNotFoundError
          ? `This tablet has no rate for ${named} as of ${businessDate()}. Sync, or ask the office whether the rate has been entered.`
          : `Two rates both cover ${named} on ${businessDate()}. This is a data problem, not something to guess past -- tell the office. (${String(caught)})`,
      );
    }
  };

  return (
    <ScrollView style={styles.screen}>
      <Text style={styles.heading}>On-the-spot fee</Text>

      {choices.map((choice) => {
        // Field comparison, not `pick === choice` (review, minor): `choices` is a fresh
        // array after every `load()` -- including the "Sync now" retry below -- so a
        // reference check would drop the highlight on a still-valid pick and, now that a
        // mismatched tap is refused rather than a no-op, could read as that refusal to a
        // collector who never actually lost their selection.
        const isPicked =
          pick !== null &&
          pick.fee_type_id === choice.fee_type_id &&
          pick.rate_class === choice.rate_class;
        const isLockedOut = lockedFeeTypeId !== null && choice.fee_type_id !== lockedFeeTypeId;
        return (
          <Pressable
            key={`${choice.fee_type_id}|${choice.rate_class ?? ""}`}
            style={[styles.choice, isPicked && styles.choiceOn, isLockedOut && styles.choiceLocked]}
            onPress={() => {
              if (isLockedOut) {
                // Named, not a silent no-op -- the stranding pattern this phase keeps
                // finding. Says which fee the receipt is already for and what to do.
                setError(
                  `This receipt is already for ${lockedFeeName}. ${choice.fee_name} needs its own receipt -- add it after this one is recorded.`,
                );
                return;
              }
              setError(null);
              setPick(choice);
            }}
          >
            <Text style={styles.choiceText}>
              {choice.fee_name}
              {choice.rate_class ? ` · ${choice.rate_class}` : ""}
            </Text>
          </Pressable>
        );
      })}

      <Text style={styles.label}>Quantity</Text>
      <TextInput
        style={styles.input}
        keyboardType="number-pad"
        value={qty}
        onChangeText={setQty}
      />
      <Button title="Add to receipt" disabled={pick === null} onPress={addLine} />
      {error ? (
        <View style={styles.errorBox}>
          <Text style={styles.error}>{error}</Text>
          <Button
            title="Sync now"
            onPress={async () => {
              await syncNow();
              await load();
            }}
          />
        </View>
      ) : null}

      {lines.map((line, index) => (
        <View key={index} style={styles.line}>
          <Text style={styles.lineText}>
            {line.quantity} × {format(line.unitRate)}
            {line.rateClass ? ` · ${line.rateClass}` : ""}
          </Text>
          <Text style={styles.lineAmount}>{format(line.amount)}</Text>
        </View>
      ))}

      <Text style={styles.total}>Receipt total {format(gross)}</Text>

      <Button
        title="Proceed to payment"
        disabled={lines.length === 0}
        onPress={() => {
          setDraft({
            kind: "lines",
            // Enforced by the choice guard above, not assumed: a tap on a different fee
            // type is refused before `pick` -- and so a line -- can hold it, so every line
            // here already shares one fee type by construction. That is what makes
            // lines[0] a safe stand-in for "the receipt's fee type", which is what parent
            // §10's Abstract of Collections totals by.
            feeTypeId: lines[0]!.feeTypeId,
            label: "On-the-spot fee",
            lines,
            grossAmount: gross,
          });
          router.push("/receipt");
        }}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: 16 },
  heading: { fontSize: 22, fontWeight: "700", marginBottom: 12 },
  choice: { padding: 12, borderWidth: 1, borderColor: "#ddd", borderRadius: 6, marginBottom: 6 },
  choiceOn: { backgroundColor: "#e3f2fd", borderColor: "#1976d2" },
  choiceLocked: { opacity: 0.4 },
  choiceText: { fontSize: 16 },
  label: { marginTop: 12, fontSize: 14, color: "#666" },
  input: { borderWidth: 1, borderColor: "#999", borderRadius: 6, padding: 12, fontSize: 22 },
  errorBox: { backgroundColor: "#ffebee", padding: 10, borderRadius: 6, marginTop: 10, gap: 8 },
  error: { color: "#b71c1c", fontSize: 14 },
  line: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 10 },
  lineText: { fontSize: 15 },
  lineAmount: { fontSize: 15, fontWeight: "600" },
  total: { marginTop: 16, fontSize: 24, fontWeight: "700", marginBottom: 12 },
});
