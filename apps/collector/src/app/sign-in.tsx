import { useCallback, useEffect, useState } from "react";
import { useFocusEffect, useRouter } from "expo-router";
import { View } from "react-native";
import {
  canSignIn,
  clearPinFailures,
  recordPinFailure,
  type SignInBlock,
} from "@ceedo/sync-engine";
// Relative, not the `@/modules/...` alias the Expo docs show: this project maps `@/*` to
// `./src/*`, so that alias would resolve to src/modules/ and silently miss.
import { verify as nativeVerify, meetsExpectedCost } from "../../modules/ceedo-bcrypt";
import {
  Action,
  Body,
  Field,
  Label,
  Punch,
  RackHead,
  List,
  Rift,
  Screen,
  Slot,
  Statement,
  missing,
} from "../ui";
import { syncFailure } from "../ui/failures";
import { deviceDriver } from "../db/driver";
import { setSession } from "../auth/session";
import { onSyncSettled, syncNow } from "../sync/device-sync";
import { SyncHealthNotice } from "../sync/SyncHealthNotice";
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
    "This tablet has synced, but no collector has a collection area yet — so the sync " +
    "brought no collectors with it. An administrator gives each collector a collection " +
    "area on the web; then sync again.",
  no_pin:
    "No PIN is set for this collector. An administrator sets it on the web, and it " +
    "reaches this tablet on the next sync.",
  locked: "Locked after five incorrect PINs. Tap Sync now with signal to unlock.",
  other_shift_open:
    "Another collector's shift is still open on this tablet. Close it out first — " +
    "that works without signal.",
  close_refused:
    "The server did not accept an earlier closeout from this tablet, so that shift is " +
    "still open on the server. A supervisor has to reconcile it; sync again afterwards " +
    "and sign-in opens.",
};

const MAX_PIN_FAILURES = 5;

export default function SignIn() {
  const router = useRouter();
  const driver = deviceDriver();

  const [collectors, setCollectors] = useState<Collector[]>([]);
  const [collectorId, setCollectorId] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  /**
   * TWO CHANNELS, NOT ONE. `notice` used to carry both "the sync finished" and "this
   * PIN was stored with a weaker setting than expected", and both rendered amber -- so a
   * successful sync announced itself in the colour this app reserves for a problem.
   */
  const [done, setDone] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /**
   * Why sign-in is blocked before anyone has typed anything, or null if it is not.
   *
   * Computed on load rather than only on submit, because the commonest blockers -- no
   * collectors on this tablet at all -- are visible before the collector touches the screen,
   * and making them tap a name and type six digits to be told so is a small cruelty at 5am.
   */
  const [blockedReason, setBlockedReason] = useState<SignInBlock | null>(null);

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
    setBlockedReason(gate.ok ? null : gate.reason);
  }, [driver]);

  // Re-read on every focus. A sync that runs while this screen is backgrounded can add the
  // collector the person in front of it is waiting for, or clear their lock.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  // The launch sync (useAutoSync) usually lands while this screen is already up, and it is
  // the one that brings a new collector's name onto the tablet.
  useEffect(() => onSyncSettled(() => void load()), [load]);

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
    setDone(null);

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

  /**
   * A DISABLED BUTTON THAT DOES NOT SAY WHY IS A DEAD END WITH NO SIGN ON IT. This caught
   * a real person: with two collectors in scope neither is auto-selected (see load()), so
   * a PIN typed without first tapping a name left the button inert with nothing on screen
   * explaining it. `missing` says BOTH when both are missing rather than whichever is
   * checked first, and `Punch` has no way to be disabled without a reason at all.
   */
  const blocked = verifying
    ? null
    : syncing
      ? "Waiting for the sync to finish."
      : collectors.length === 0
        ? "No collectors on this tablet yet — sync first."
        : missing(
            !collectorId && "Tap your name above.",
            pin.length === 0 && "Enter your PIN.",
          );

  return (
    <Screen
      head={<RackHead title="Sign in" subtitle="CEEDO Collector" icon="account-key-outline" />}
      shelf={
        <Punch
          label="Sign in"
          icon="login"
          blocked={blocked}
          busy={verifying}
          busyLabel="Checking"
          onPress={() => void submit()}
        />
      }
    >
      {/* The accurate reason, from canSignIn -- never a guess made from an empty list. */}
      {collectors.length === 0 && blockedReason ? (
        <>
          <Statement tone="refusal">{MESSAGES[blockedReason]}</Statement>
          <Rift h={16} />
        </>
      ) : null}

      <SyncHealthNotice />

      {/*
        A SYNC BUTTON HERE IS NOT A CONVENIENCE, IT IS THE WAY OUT OF A DEAD END.
        Collectors reach the device only through the pull. A tablet enrolled before its
        collectors had collection areas has an empty collector list, and every other sync in the
        app sits behind the shift screen -- which is behind this one. Without this button
        that tablet can only be recovered by re-enrolling it, which needs a credential that
        is shown once and cannot be read back.
      */}
      <Action
        label="Sync now"
        icon="sync"
        busy={syncing}
        busyLabel="Syncing"
        blocked={verifying ? "Waiting for the PIN check to finish." : null}
        onPress={async () => {
          setSyncing(true);
          setError(null);
          setErrorDetail(null);
          setNotice(null);
          setDone(null);
          try {
            const outcome = await syncNow();
            setDone(
              `Synced${outcome.fullResync ? " (full re-sync)" : ""}. ` +
                "The collector list below is up to date.",
            );
          } catch (e) {
            const said = syncFailure(e);
            setError(said.said);
            setErrorDetail(said.detail);
          } finally {
            setSyncing(false);
            await load();
          }
        }}
      />

      <Rift />

      {/* No heading when there is nothing under it. An empty "COLLECTOR" label above an
          empty space is a section that looks broken rather than one that is simply not
          populated yet -- and the refusal above has already said why it is empty. */}
      {collectors.length === 0 ? null : (
        <>
          <Label>Collector</Label>
          <View style={{ height: 8 }} />
          <List>
            {collectors.map((collector) => (
              <Slot
                key={collector.id}
                selectable
                selected={collectorId === collector.id}
                suppressed={collectorId !== null && collectorId !== collector.id}
                onPress={() => setCollectorId(collector.id)}
                left={
                  <View style={{ gap: 2 }}>
                    <Body>{collector.full_name ?? collector.id}</Body>
                    {collector.employee_no ? <Label>{collector.employee_no}</Label> : null}
                  </View>
                }
              />
            ))}
          </List>
        </>
      )}

      <Rift />

      <Field
        label="PIN"
        voice="mono"
        icon="lock-outline"
        value={pin}
        onChangeText={setPin}
        placeholder="6 digits"
        keyboardType="number-pad"
        secureTextEntry
        maxLength={6}
      />

      {error ? (
        <>
          <Rift h={16} />
          <Statement tone="refusal" detail={errorDetail}>
            {error}
          </Statement>
        </>
      ) : null}
      {done ? (
        <>
          <Rift h={12} />
          <Statement tone="confirmed">{done}</Statement>
        </>
      ) : null}
      {notice ? (
        <>
          <Rift h={12} />
          <Statement tone="warning">{notice}</Statement>
        </>
      ) : null}
    </Screen>
  );
}
