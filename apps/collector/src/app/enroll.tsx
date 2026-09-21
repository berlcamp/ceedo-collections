import { useState } from "react";
import { useRouter } from "expo-router";
import { StyleSheet, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useMigrations } from "drizzle-orm/expo-sqlite/migrator";
import { drizzle } from "drizzle-orm/expo-sqlite";
import { decodeEnrollment, encodeEnrollment } from "@ceedo/shared";
import {
  Action,
  Body,
  Field,
  Label,
  Note,
  Punch,
  RackHead,
  Rift,
  Screen,
  Statement,
  color,
  missing,
} from "../ui";
import migrations from "../../drizzle/migrations";
import { openDeviceDb } from "../db/client";
import { saveCredential, type Credential } from "../auth/credential-store";
import { runSync } from "../sync/device-sync";

/**
 * Spec E6. The credential reaches Keystore-backed storage and nowhere else.
 *
 * TWO PATHS, AND THE SECOND IS NOT OPTIONAL. Parent §9.4 already makes manual entry the
 * mandatory fallback for QR in this system, and the reasoning carries: a camera that will
 * not focus at 5am, a cracked lens, a printed code that smudged. Both paths feed the same
 * `decodeEnrollment`, so the fallback is a fallback rather than a second feature.
 */
export default function Enroll() {
  const router = useRouter();
  const db = openDeviceDb();
  // The schema must exist before the first sync writes into it, and enrollment is the
  // earliest moment a tablet touches the database at all.
  const { success, error: migrationError } = useMigrations(drizzle(db), migrations);

  const [permission, requestPermission] = useCameraPermissions();
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [credentialId, setCredentialId] = useState("");
  const [secret, setSecret] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [statusDetail, setStatusDetail] = useState<string | null>(null);
  const [failedSync, setFailedSync] = useState(false);

  async function accept(text: string) {
    setScanning(false);
    setError(null);
    setStatus(null);
    setStatusDetail(null);

    const decoded = decodeEnrollment(text);
    if (!decoded) {
      // Distinguishable from a network failure on purpose. A checksum mismatch is a typo
      // or a damaged code, and the person holding the tablet can fix it in five seconds if
      // they are told that is what it is.
      setError("That code did not scan cleanly. Re-scan, or type the values instead.");
      return;
    }

    setBusy(true);
    try {
      await saveCredential(decoded satisfies Credential);

      // ENROLLMENT MUST FORCE A FIRST SYNC BEFORE THE TABLET LEAVES THE OFFICE.
      // Collectors reach the device only through the pull, so an enrolled-but-unsynced
      // tablet has no collectors at all and cannot be signed into. Discovering that at 5am
      // at a market is the failure this forces into the office instead.
      await runSync(decoded.credentialId, decoded.secret);
      setFailedSync(false);
      setStatusDetail(null);
      setStatus("Enrolled and synced. This tablet is ready.");
    } catch (e) {
      // The credential is KEPT, not rolled back. It may well be correct and the network
      // merely absent, and discarding it would make the retry below impossible -- the
      // secret is shown once on the web and cannot be read back.
      setFailedSync(true);
      setStatus(
        "Enrolled, but the first sync failed. Stay on the office network and retry — " +
          "this tablet cannot be signed into until it syncs once.",
      );
      setStatusDetail(String(e));
    } finally {
      setBusy(false);
    }
  }

  /**
   * Manual entry rebuilds the payload rather than bypassing the codec, so a typed
   * credential goes through the same checksum a scanned one does. Typing the two values
   * separately is what an admin reading them off the web screen is actually doing; asking
   * them to transcribe the checksum as well would add a third field whose only purpose is
   * to be got wrong.
   */
  function acceptTyped() {
    const id = credentialId.trim();
    const sec = secret.trim();
    if (id.includes(":") || sec.includes(":")) {
      setError("Neither value contains a colon — check for a stray paste.");
      return;
    }
    // Re-encoded through the shared codec rather than concatenated here: `encodeEnrollment`
    // is the one definition of this format, checksum included, and a second copy of it on
    // the device is exactly the drift packages/shared exists to prevent. The typed path
    // therefore goes through the identical decode the scanned path does.
    void accept(encodeEnrollment(id, sec));
  }

  if (migrationError) {
    return (
      <Screen head={<RackHead title="Enrol this tablet" onBack={() => router.back()} />}>
        <Statement tone="refusal">{`Migration error: ${migrationError.message}`}</Statement>
      </Screen>
    );
  }
  if (!success) {
    return (
      <Screen head={<RackHead title="Enrol this tablet" onBack={() => router.back()} />}>
        <Note>Preparing the device database…</Note>
      </Screen>
    );
  }

  return (
    <Screen
      head={
        <RackHead
          title="Enrol this tablet"
          subtitle="Once, at the office"
          onBack={() => router.back()}
        />
      }
      shelf={
        <Punch
          label="Enrol with these values"
          busy={busy}
          busyLabel="Enrolling"
          blocked={missing(
            credentialId.trim() === "" && "Enter the credential ID.",
            secret.trim() === "" && "Enter the secret.",
          )}
          onPress={acceptTyped}
        />
      }
    >
      <Body>
        Scan the QR code on the admin&apos;s Device credential screen, or type the two values
        from it. The secret is shown there once and cannot be read back.
      </Body>

      <Rift />

      {scanning && permission?.granted ? (
        <>
          <View style={camera.frame}>
            <CameraView
              style={StyleSheet.absoluteFill}
              barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
              onBarcodeScanned={({ data }) => void accept(data)}
            />
          </View>
          <Rift h={12} />
        </>
      ) : null}

      <Action
        label={scanning ? "Stop scanning" : "Scan the QR code"}
        blocked={busy ? "Waiting for the current enrolment to finish." : null}
        onPress={async () => {
          if (scanning) {
            setScanning(false);
            return;
          }
          const granted = permission?.granted ? permission : await requestPermission();
          if (!granted.granted) {
            // Not a dead end: the whole reason manual entry exists.
            setError("Camera permission was refused. Type the credential ID and secret instead.");
            return;
          }
          setError(null);
          setScanning(true);
        }}
      />

      <Rift />

      {/* 24, not 12: a section label sitting twelve pixels above a field label reads as
          one four-word heading rather than as two levels. */}
      <Label>Or type it</Label>
      <Rift h={24} />

      <Field
        label="Credential ID"
        voice="mono"
        value={credentialId}
        onChangeText={setCredentialId}
        placeholder="Credential ID"
        autoCapitalize="none"
        autoCorrect={false}
      />
      <Rift h={16} />
      <Field
        label="Secret"
        voice="mono"
        value={secret}
        onChangeText={setSecret}
        placeholder="Secret"
        autoCapitalize="none"
        autoCorrect={false}
      />

      {error ? (
        <>
          <Rift h={16} />
          <Statement tone="refusal">{error}</Statement>
        </>
      ) : null}
      {status ? (
        <>
          <Rift h={16} />
          <Statement tone={failedSync ? "warning" : "confirmed"} detail={statusDetail}>
            {status}
          </Statement>
        </>
      ) : null}
    </Screen>
  );
}

const camera = StyleSheet.create({
  frame: {
    height: 300,
    borderRadius: 4,
    overflow: "hidden",
    backgroundColor: color.ink,
  },
});
