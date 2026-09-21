import { useEffect, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  ActivityIndicator,
  Button,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { closeShift, deviceTotals, type CloseOutcome } from "@ceedo/sync-engine";
import { parsePesoInput, toDecimalString } from "@ceedo/shared";
import { deviceDriver } from "../db/driver";
import { businessDate } from "../sync/device-sync";
import { apiConfig } from "../sync/config";
import { httpTransport } from "../sync/transport";
import { loadCredential } from "../auth/credential-store";

/**
 * Parent §6.5 step 5: "Collector declares physical cash; variance is recorded, not hidden."
 *
 * The screen shows the device's own figures BEFORE the field, and the declared amount is
 * typed rather than prefilled. Prefilling the system total is the one thing this screen must
 * not do: a collector who is short would only have to accept the default for the shortfall
 * to vanish, and §6.5 exists to stop exactly that.
 */
export default function Closeout() {
  const router = useRouter();
  const { shiftId } = useLocalSearchParams<{ shiftId: string }>();
  const driver = deviceDriver();

  const [totals, setTotals] = useState({ count: 0, total: "0.00" });
  const [declared, setDeclared] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<CloseOutcome | null>(null);

  useEffect(() => {
    if (!shiftId) return;
    void deviceTotals(driver, shiftId).then(setTotals);
  }, [driver, shiftId]);

  async function submit() {
    if (!shiftId) return;
    setError(null);

    let declaredTotal: string;
    try {
      declaredTotal = toDecimalString(parsePesoInput(declared));
    } catch {
      setError("Enter the cash in the drawer, for example 1250.00.");
      return;
    }

    const credential = await loadCredential();
    if (!credential) {
      setError("This tablet is not enrolled.");
      return;
    }

    setBusy(true);
    try {
      setOutcome(
        await closeShift(
          driver,
          {
            transport: httpTransport(apiConfig()),
            credentialId: credential.credentialId,
            secret: credential.secret,
            businessDate: businessDate(),
          },
          { shiftId, declaredTotal },
        ),
      );
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <Text style={styles.body}>This tablet recorded, for this shift:</Text>
      <Text style={styles.figure}>
        {totals.count} receipt{totals.count === 1 ? "" : "s"} · ₱{totals.total}
      </Text>

      <Text style={styles.heading}>Cash in the drawer</Text>
      <TextInput
        value={declared}
        onChangeText={setDeclared}
        placeholder="0.00"
        keyboardType="decimal-pad"
        style={styles.input}
        editable={!outcome}
      />

      {!outcome ? (
        <Button title={busy ? "Closing…" : "Close the shift"} onPress={() => void submit()} disabled={busy} />
      ) : null}
      {busy ? <ActivityIndicator /> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}

      {outcome?.status === "mismatch" ? (
        <View style={styles.mismatch}>
          <Text style={styles.heading}>Records do not match. The shift is still open.</Text>
          <Text style={styles.body}>
            This tablet: {outcome.deviceCount} · ₱{outcome.deviceTotal}
            {"\n"}
            The server: {outcome.systemCount} · ₱{outcome.systemTotal}
          </Text>
          <Text style={styles.body}>
            Nothing was written. A supervisor has to reconcile the difference before this
            shift can close — it is a records problem, not a cash one.
          </Text>
        </View>
      ) : null}

      {outcome?.status === "closed" ? (
        <View style={styles.closed}>
          <Text style={styles.heading}>Shift closed.</Text>
          <Text style={styles.body}>
            Server: {outcome.systemCount} · ₱{outcome.systemTotal}
            {"\n"}
            Declared: ₱{outcome.declaredTotal}
          </Text>
          {/* Signed, and said in words as well as digits: over and short are different
              problems and a supervisor reading only a number would not know which. */}
          <Text style={styles.figure}>
            Variance ₱{outcome.variance}
            {Number(outcome.variance) === 0
              ? " — balanced"
              : Number(outcome.variance) < 0
                ? " — short"
                : " — over"}
          </Text>
        </View>
      ) : null}

      {outcome?.status === "closed_unsynced" ? (
        <View style={styles.closed}>
          <Text style={styles.heading}>Closed on this tablet.</Text>
          <Text style={styles.body}>
            The closeout has not reached the server yet and will be sent at the next sync.
            You can hand the tablet over — the next collector can sign in. ({outcome.detail})
          </Text>
        </View>
      ) : null}

      {outcome ? <Button title="Back to the shift" onPress={() => router.replace("/shift")} /> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { padding: 24, gap: 12 },
  heading: { fontSize: 16, fontWeight: "600", color: "#0f172a" },
  body: { fontSize: 14, lineHeight: 20, color: "#475569" },
  figure: { fontSize: 20, fontWeight: "600", color: "#0f172a" },
  input: {
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily: Platform.select({ android: "monospace", default: "Menlo" }),
    fontSize: 18,
  },
  error: { color: "#b91c1c", fontSize: 13, lineHeight: 18 },
  mismatch: { padding: 16, borderRadius: 8, backgroundColor: "#fef2f2", gap: 8 },
  closed: { padding: 16, borderRadius: 8, backgroundColor: "#f0fdf4", gap: 8 },
});
