import { useCallback, useEffect, useState } from "react";
import { useRouter } from "expo-router";
import { Button, StyleSheet, Text, TextInput, View } from "react-native";
import { randomUUID } from "expo-crypto";
import { validateOrEntry, type OrEntryContext } from "@ceedo/shared";
import { enqueue, orEntryContext } from "@ceedo/sync-engine";
import { deviceDriver } from "../db/driver";
import { signedIn } from "../auth/session";

/**
 * A form written wrong is spoiled and a new one issued. Spec D4 (3b-i), unchanged.
 *
 * There is deliberately no way to cancel a POSTED collection from the tablet: a collector
 * who can cancel their own receipts can make a shortfall disappear. Cancelling stays a
 * supervisor act on the web. This screen is the collector's whole remedy, and it is the
 * same one the paper process already gives them.
 *
 * The serial must be one of theirs and not already used -- but a spoiled form is NOT a
 * consumed one, so validateOrEntry's `already_consumed` is a genuine refusal here: a
 * number that carries a real receipt cannot also be spoiled.
 */
export default function Spoil() {
  const router = useRouter();
  const driver = deviceDriver();
  const collector = signedIn();

  const [context, setContext] = useState<OrEntryContext | null>(null);
  const [contextError, setContextError] = useState<string | null>(null);
  const [orText, setOrText] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Named so the "Try again" button can call the exact same load rather than duplicating
  // it. If this read fails, `context` stays null and "Mark spoiled" would otherwise stay
  // disabled with nothing on screen saying why -- the same stranding shape receipt.tsx
  // guards against. So it always resolves one way or the other: either a context, or a
  // stated reason plus a way to retry.
  const loadContext = useCallback(() => {
    if (!collector) return;
    setContextError(null);
    orEntryContext(driver, collector.id)
      .then(setContext)
      .catch((caught: unknown) => {
        setContextError(`Could not load your booklets: ${String(caught)}`);
      });
  }, [collector, driver]);

  useEffect(() => {
    loadContext();
  }, [loadContext]);

  if (!collector) return <Text style={styles.note}>Sign in first.</Text>;

  // Guards against a lone "-" or "." on the number pad: parseInt on a non-numeric partial
  // yields NaN, which the Number.isInteger check below simply treats as "not ready yet"
  // rather than throwing.
  const orNo = Number.parseInt(orText, 10);
  const check =
    context && Number.isInteger(orNo) && orNo > 0 ? validateOrEntry(context, orNo) : null;
  const reasonGiven = reason.trim() !== "";

  return (
    <View style={styles.screen}>
      <Text style={styles.heading}>Spoil a form</Text>
      <Text style={styles.body}>
        The form stays in the booklet and is accounted for on return: used + spoiled +
        unused must equal the total serials.
      </Text>

      <TextInput
        style={styles.input}
        keyboardType="number-pad"
        placeholder="OR number"
        value={orText}
        onChangeText={(text) => {
          setOrText(text);
          setError(null);
        }}
      />
      <TextInput
        style={styles.input}
        placeholder="Why (torn, misprinted, wrong amount…)"
        value={reason}
        onChangeText={setReason}
      />

      {contextError ? (
        <View style={styles.warnBox}>
          <Text style={styles.error}>{contextError}</Text>
          <Button title="Try again" onPress={loadContext} />
        </View>
      ) : !context ? (
        <Text style={styles.note}>Loading your booklets…</Text>
      ) : null}

      {check && !check.ok ? (
        <Text style={styles.error}>
          {check.reason === "already_consumed"
            ? "That number carries a receipt already. It cannot be spoiled."
            : check.reason === "marked_spoiled"
              ? "That number is already marked spoiled."
              : check.reason === "ambiguous_booklet"
                ? "That number falls inside two of your booklets. Check the form type before spoiling it."
                : "That number is not inside any booklet assigned to you."}
        </Text>
      ) : null}
      {check?.ok && !reasonGiven ? (
        <Text style={styles.note}>Give a reason before this form can be marked spoiled.</Text>
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Button
        title="Mark spoiled"
        disabled={busy || !check?.ok || !reasonGiven}
        onPress={async () => {
          if (!check?.ok || !reasonGiven) return;
          setBusy(true);
          setError(null);
          try {
            await enqueue(driver, {
              id: randomUUID(),
              type: "spoiled_form",
              payload: {
                booklet_id: check.bookletId,
                or_no: orNo,
                collector_id: collector.id,
                reason: reason.trim(),
              },
              collectorId: collector.id,
            });
            router.replace("/shift");
          } catch (caught) {
            setError(`Not recorded: ${String(caught)}`);
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
  heading: { fontSize: 22, fontWeight: "700" },
  body: { fontSize: 14, color: "#666" },
  input: { borderWidth: 1, borderColor: "#999", borderRadius: 6, padding: 12, fontSize: 18 },
  error: { color: "#b71c1c", fontSize: 15 },
  warnBox: { backgroundColor: "#fff8e1", padding: 10, borderRadius: 6, gap: 8 },
  note: { padding: 16, fontSize: 15, color: "#666" },
});
