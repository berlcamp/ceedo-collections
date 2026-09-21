import { useEffect, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { closeShift, deviceTotals, type CloseOutcome } from "@ceedo/sync-engine";
import { parsePesoInput, toDecimalString } from "@ceedo/shared";
import {
  Amount,
  Body,
  Field,
  Figure,
  Group,
  Label,
  Punch,
  RackHead,
  Register,
  Rift,
  Screen,
  Statement,
  Title,
} from "../ui";
import { fromWire } from "../ui/money";
import { freshness, type Freshness } from "../ui/staleness";
import { syncFailure } from "../ui/failures";
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
 * to vanish, and §6.5 exists to stop exactly that. Nothing in the redesign gives the field
 * a default, a suggestion, or a "same as system" shortcut.
 *
 * Money goes through `format()` here too -- see the note in shift.tsx. Every figure on this
 * screen is a wire-form decimal string from the engine, and a variance printed in one
 * notation beside a total printed in another is the last thing a reconciliation screen
 * should hand a supervisor.
 */
export default function Closeout() {
  const router = useRouter();
  const { shiftId } = useLocalSearchParams<{ shiftId: string }>();
  const driver = deviceDriver();

  const [totals, setTotals] = useState({ count: 0, total: "0.00" });
  const [declared, setDeclared] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<CloseOutcome | null>(null);
  const [fresh, setFresh] = useState<Freshness | null>(null);

  useEffect(() => {
    if (!shiftId) return;
    void deviceTotals(driver, shiftId).then(setTotals);
    void freshness(driver, businessDate()).then(setFresh);
  }, [driver, shiftId]);

  async function submit() {
    if (!shiftId) return;
    setError(null);
    setErrorDetail(null);

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
      // A bare String(e) was the whole message here -- a closeout is the one screen where
      // a collector must know whether the shift closed, and a raw throw does not say.
      const said = syncFailure(e);
      setError(`${said.said} The shift is still open.`);
      setErrorDetail(said.detail);
    } finally {
      setBusy(false);
    }
  }

  const variance = outcome?.status === "closed" ? Number(outcome.variance) : 0;

  return (
    <Screen
      head={
        <RackHead
          title="Close out"
          subtitle={`Business date ${businessDate()}`}
          onBack={() => router.back()}
          register={fresh ? <Register state={fresh.state} detail={fresh.short} /> : undefined}
        />
      }
      shelf={
        outcome ? (
          <Punch label="Back to the shift" onPress={() => router.replace("/shift")} />
        ) : (
          <Punch
            label="Close the shift"
            busy={busy}
            busyLabel="Closing"
            blocked={
              declared.trim() === ""
                ? "Enter the cash counted out of the drawer before closing."
                : null
            }
            onPress={() => void submit()}
          />
        )
      }
    >
      <Figure
        label={`This tablet recorded · ${totals.count} receipt${totals.count === 1 ? "" : "s"}`}
        value={fromWire(totals.total)}
        absent="This tablet cannot read its own total for this shift. Do not close out — tell the office."
      />

      <Rift />

      {/* Typed, never prefilled. See the note at the top of this file. */}
      <Field
        label="Cash in the drawer"
        voice="figure"
        value={declared}
        onChangeText={setDeclared}
        placeholder="0.00"
        keyboardType="decimal-pad"
        editable={!outcome}
      />
      <Rift h={8} />
      <Body>Count the cash first. Do not copy the figure above.</Body>

      {error ? (
        <>
          <Rift h={16} />
          <Statement tone="refusal" detail={errorDetail}>
            {error}
          </Statement>
        </>
      ) : null}

      {outcome?.status === "mismatch" ? (
        <>
          <Rift />
          <Statement tone="refusal">
            <Group gap={10}>
              <Title>Records do not match. The shift is still open.</Title>
              <Amount
                label={`This tablet · ${outcome.deviceCount} receipt${outcome.deviceCount === 1 ? "" : "s"}`}
                value={fromWire(outcome.deviceTotal)}
              />
              <Amount
                label={`The server · ${outcome.systemCount} receipt${outcome.systemCount === 1 ? "" : "s"}`}
                value={fromWire(outcome.systemTotal)}
              />
              <Body>
                Nothing was written. A supervisor has to reconcile the difference before
                this shift can close — it is a records problem, not a cash one.
              </Body>
            </Group>
          </Statement>
        </>
      ) : null}

      {outcome?.status === "closed" ? (
        <>
          <Rift />
          <Statement tone={variance === 0 ? "confirmed" : "warning"}>
            <Group gap={10}>
              <Title>Shift closed.</Title>
              <Amount
                label={`Server · ${outcome.systemCount} receipt${outcome.systemCount === 1 ? "" : "s"}`}
                value={fromWire(outcome.systemTotal)}
              />
              <Amount label="Declared" value={fromWire(outcome.declaredTotal)} />
            </Group>
          </Statement>
          <Rift h={16} />
          {/* Signed, and said in words as well as digits: over and short are different
              problems and a supervisor reading only a number would not know which. */}
          <Figure
            label={
              variance === 0 ? "Variance — balanced" : variance < 0 ? "Variance — short" : "Variance — over"
            }
            value={fromWire(outcome.variance)}
            tone={variance === 0 ? "confirmed" : "refusal"}
            absent="The variance could not be read. Tell the office before handing the tablet over."
          />
        </>
      ) : null}

      {outcome?.status === "closed_unsynced" ? (
        <>
          <Rift />
          <Statement tone="warning">
            <Group gap={10}>
              <Title>Closed on this tablet.</Title>
              <Body>
                The closeout has not reached the server yet and will be sent at the next
                sync. You can hand the tablet over — the next collector can sign in.
              </Body>
              <Label>{outcome.detail}</Label>
            </Group>
          </Statement>
        </>
      ) : null}
    </Screen>
  );
}
