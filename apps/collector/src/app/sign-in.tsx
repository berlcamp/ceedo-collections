import { useCallback, useEffect, useState } from "react";
import { useFocusEffect, useRouter } from "expo-router";
import {
  ActivityIndicator,
  Button,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  canSignIn,
  clearPinFailures,
  recordPinFailure,
  type SignInBlock,
} from "@ceedo/sync-engine";
// Relative, not the `@/modules/...` alias the Expo docs show: this project maps `@/*` to
// `./src/*`, so that alias would resolve to src/modules/ and silently miss.
import { verify as nativeVerify, meetsExpectedCost } from "../../modules/ceedo-bcrypt";
import { openDeviceDb } from "../db/client";
import { expoSqliteDriver } from "../db/driver";
import { setSession } from "../auth/session";
import { syncNow } from "../sync/device-sync";
import type { Collector } from "../auth/types";

/**
 * Spec E10 and parent §4.4. Sign-in works with no signal at all: the collector list and the
 * PIN hashes both arrive by pull and are verified locally.
 *
 * FIVE REFUSALS, NOT ONE. Each of these looks like "sign-in failed" to someone standing in
 * a market at 5am, and each needs a different action. Collapsing them into one message
 * makes four of the five undiagnosable in the field -- which is why `canSignIn` returns a
 * reason rather than a boolean.
 */
const MESSAGES: Record<SignInBlock, string> = {
  never_synced:
    "This tablet has not synced yet, so it has no collectors. Connect to the office " +
    "network and sync before the round.",
  not_assigned:
    "This tablet has synced, but it is not assigned to a market yet — so the sync brought " +
    "no collectors with it. An administrator assigns the tablet to a facility; then sync " +
    "again.",
  no_pin:
    "No PIN is set for this collector. An administrator sets it on the web, and it " +
    "reaches this tablet on the next sync.",
  locked: "Locked after five incorrect PINs. This clears on the next successful sync.",
  other_shift_open:
    "Another collector's shift is still open on this tablet. Close it out first — " +
    "that works without signal.",
};

const MAX_PIN_FAILURES = 5;

export default function SignIn() {
  const router = useRouter();
  const driver = expoSqliteDriver(openDeviceDb());

  const [collectors, setCollectors] = useState<Collector[]>([]);
  const [collectorId, setCollectorId] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /**
   * Why sign-in is blocked before anyone has typed anything, or null if it is not.
   *
   * Computed on load rather than only on submit, because the commonest blockers -- no
   * collectors on this tablet at all -- are visible before the collector touches the screen,
   * and making them tap a name and type six digits to be told so is a small cruelty at 5am.
   */
  const [blocked, setBlocked] = useState<SignInBlock | null>(null);

  const load = useCallback(async () => {
    const rows = await driver.select<Collector>(
      "select id, employee_no, full_name, pin_hash, status from collectors order by full_name",
    );
    setCollectors(rows);
    // Not auto-selected when there are several: picking the wrong name and then typing a
    // correct PIN spends one of five attempts on someone else's counter.
    if (rows.length === 1) setCollectorId(rows[0]?.id ?? null);

    // `canSignIn` is the single definition of what blocks a sign-in, so the banner asks IT
    // rather than re-deriving a reason from `rows.length` -- which is how this screen came
    // to claim "not synced yet" about a tablet that had just synced perfectly well.
    const gate = await canSignIn(driver, rows[0]?.id ?? "");
    setBlocked(gate.ok ? null : gate.reason);
  }, [driver]);

  // Re-read on every focus. A sync that runs while this screen is backgrounded can add the
  // collector the person in front of it is waiting for, or clear their lock.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  useEffect(() => {
    setError(null);
    setPin("");
  }, [collectorId]);

  async function submit() {
    if (!collectorId) {
      setError("Choose a collector first.");
      return;
    }
    setError(null);
    setNotice(null);

    const gate = await canSignIn(driver, collectorId);
    if (!gate.ok) {
      setError(MESSAGES[gate.reason]);
      return;
    }

    const collector = collectors.find((c) => c.id === collectorId);
    if (!collector?.pin_hash) {
      // canSignIn already covers this; belt and braces, because the alternative below is a
      // non-null assertion on a value that arrives over a network.
      setError(MESSAGES.no_pin);
      return;
    }

    // A hash below cost 12 is a server misconfiguration. It is surfaced, not enforced:
    // refusing to authenticate a collector at 5am for something only the office can fix
    // would punish the wrong person (the module's own `meetsExpectedCost` comment).
    if (!meetsExpectedCost(collector.pin_hash)) {
      setNotice(
        "This PIN was stored with a weaker setting than expected. Sign-in still works; " +
          "tell the office.",
      );
    }

    setVerifying(true);
    // NATIVE, never bcrypt.compareSync. Measured on the target tablet in a release build:
    // bcryptjs under Hermes takes ~22,265 ms for this call and the native module ~482 ms,
    // a 47x difference and the whole reason modules/ceedo-bcrypt exists. An import of
    // `bcryptjs` on this path is a 22-second sign-in.
    const ok = nativeVerify(pin, collector.pin_hash);
    setVerifying(false);

    if (!ok) {
      const failures = await recordPinFailure(driver, collectorId);
      setError(
        failures >= MAX_PIN_FAILURES
          ? MESSAGES.locked
          : `Incorrect PIN. ${MAX_PIN_FAILURES - failures} attempts left before this ` +
            "collector is locked.",
      );
      setPin("");
      return;
    }

    await clearPinFailures(driver, collectorId);
    setSession(collector);
    setPin("");
    router.replace("/shift");
  }

  return (
    <ScrollView contentContainerStyle={styles.screen}>
      {/* The accurate reason, from canSignIn -- never a guess made from an empty list. */}
      {collectors.length === 0 && blocked ? (
        <Text style={styles.error}>{MESSAGES[blocked]}</Text>
      ) : null}

      {/*
        A SYNC BUTTON HERE IS NOT A CONVENIENCE, IT IS THE WAY OUT OF A DEAD END.
        Collectors reach the device only through the pull. A tablet enrolled before its
        facility assignment existed has an empty collector list, and every other sync in the
        app sits behind the shift screen -- which is behind this one. Without this button
        that tablet can only be recovered by re-enrolling it, which needs a credential that
        is shown once and cannot be read back.
      */}
      <Button
        title={syncing ? "Syncing…" : "Sync now"}
        disabled={syncing || verifying}
        onPress={async () => {
          setSyncing(true);
          setError(null);
          setNotice(null);
          try {
            const outcome = await syncNow();
            setNotice(
              `Synced${outcome.fullResync ? " (full re-sync)" : ""}. ` +
                "Pull down the collector list below.",
            );
          } catch (e) {
            setError(`Could not sync: ${String(e)}`);
          } finally {
            setSyncing(false);
            await load();
          }
        }}
      />

      <Text style={styles.heading}>Collector</Text>
      {collectors.map((collector) => (
        <Pressable
          key={collector.id}
          onPress={() => setCollectorId(collector.id)}
          style={[styles.row, collectorId === collector.id ? styles.rowSelected : null]}
        >
          <Text style={styles.rowText}>
            {collector.full_name ?? collector.id}
            {collector.employee_no ? `  ·  ${collector.employee_no}` : ""}
          </Text>
        </Pressable>
      ))}

      <Text style={styles.heading}>PIN</Text>
      <TextInput
        value={pin}
        onChangeText={setPin}
        placeholder="6 digits"
        keyboardType="number-pad"
        secureTextEntry
        maxLength={6}
        style={styles.input}
      />

      <Button
        title={verifying ? "Checking…" : "Sign in"}
        onPress={() => void submit()}
        disabled={verifying || syncing || !collectorId || pin.length === 0}
      />
      {/*
        A DISABLED BUTTON THAT DOES NOT SAY WHY IS A DEAD END WITH NO SIGN ON IT. This one
        caught a real person: with two collectors in scope neither is auto-selected (see
        load()), so a PIN typed without first tapping a name leaves the button inert and
        nothing on screen explaining it.
      */}
      {!verifying && !syncing && (!collectorId || pin.length === 0) ? (
        <Text style={styles.hint}>
          {!collectorId && collectors.length > 0
            ? "Tap your name above first."
            : collectors.length === 0
              ? "No collectors on this tablet yet — sync first."
              : "Enter your PIN."}
        </Text>
      ) : null}
      {/* ~482 ms is under the 800 ms line, so an indicator is not required by the Task 2
          decision table -- but it is perceptible, and a collector who taps twice because
          nothing moved spends two of five attempts. */}
      {verifying ? <ActivityIndicator /> : null}

      {error ? <Text style={styles.error}>{error}</Text> : null}
      {notice ? <Text style={styles.notice}>{notice}</Text> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { padding: 24, gap: 12 },
  heading: { fontSize: 16, fontWeight: "600", color: "#0f172a", marginTop: 8 },
  row: {
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  rowSelected: { borderColor: "#1d4ed8", backgroundColor: "#eff6ff" },
  rowText: { fontSize: 15, color: "#0f172a" },
  input: {
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily: Platform.select({ android: "monospace", default: "Menlo" }),
    fontSize: 18,
    letterSpacing: 6,
  },
  error: { color: "#b91c1c", fontSize: 13, lineHeight: 18 },
  notice: { color: "#92400e", fontSize: 13, lineHeight: 18 },
  hint: { color: "#64748b", fontSize: 13, lineHeight: 18 },
});
