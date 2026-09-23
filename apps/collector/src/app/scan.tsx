import { useCallback, useEffect, useRef, useState } from "react";
import { useFocusEffect, useRouter } from "expo-router";
import { StyleSheet, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { resolveCard, type CardResolution } from "@ceedo/sync-engine";
import { Action, Body, Note, RackHead, Rift, Screen, Statement, color } from "../ui";
import { deviceDriver } from "../db/driver";
import { signedIn } from "../auth/session";

/**
 * Scan a tenant's card and land on the same lease screen a search reaches. Parent §9.3.
 *
 * An accelerator, never the only path (§9.4): every refusal below offers the stall-number
 * search, and a refused camera permission sends the collector straight back to it.
 */
export default function Scan() {
  const router = useRouter();
  const driver = deviceDriver();
  const collector = signedIn();
  const [permission, requestPermission] = useCameraPermissions();
  const [refusal, setRefusal] = useState<string | null>(null);

  // onBarcodeScanned fires on every frame the code stays in view. Without this latch one
  // card would push the lease screen several times over.
  const latched = useRef(false);

  useEffect(() => {
    if (permission && !permission.granted && permission.canAskAgain) void requestPermission();
  }, [permission, requestPermission]);

  // Coming back from the lease screen re-arms the scanner for the next stall.
  useFocusEffect(
    useCallback(() => {
      latched.current = false;
      setRefusal(null);
    }, []),
  );

  async function onScanned(data: string) {
    if (latched.current) return;
    latched.current = true;
    const result = await resolveCard(driver, data);
    if (result.kind === "lease") {
      router.push(`/lease/${result.leaseId}`);
      return;
    }
    setRefusal(explain(result));
  }

  if (!collector) {
    return (
      <Screen head={<RackHead title="Scan a card" onBack={() => router.back()} />}>
        <Note>Sign in first.</Note>
      </Screen>
    );
  }

  return (
    <Screen
      head={
        <RackHead title="Scan a card" subtitle="Hold the QR inside the frame" onBack={() => router.back()} />
      }
    >
      {permission?.granted ? (
        <View style={camera.frame}>
          <CameraView
            style={StyleSheet.absoluteFill}
            barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
            onBarcodeScanned={refusal ? undefined : ({ data }) => void onScanned(data)}
          />
        </View>
      ) : (
        <Statement tone="warning">
          {permission && !permission.canAskAgain
            ? "Camera permission is off for this app. Search by stall number instead, or turn it on in Android settings."
            : "Waiting for camera permission."}
        </Statement>
      )}

      {refusal ? (
        <>
          <Rift h={16} />
          <Statement tone="refusal">{refusal}</Statement>
          <Rift h={12} />
          <Action
            label="Scan again"
            onPress={() => {
              latched.current = false;
              setRefusal(null);
            }}
          />
        </>
      ) : null}

      <Rift />
      <Body tone={color.muted}>Card torn, wet or missing? Search by the stall number instead.</Body>
      <Rift h={12} />
      <Action label="Search by stall number" tone="quiet" onPress={() => router.replace("/leases")} />
    </Screen>
  );
}

function explain(result: Exclude<CardResolution, { kind: "lease" }>): string {
  switch (result.kind) {
    case "not_a_card":
      return "That is not a CEEDO tenant card.";
    case "not_on_tablet":
      return "This card's lease is not on this tablet. It may belong to another market, or it was added since the last sync. Sync at the office, or search by stall number.";
    case "ended":
      return `The lease on stall ${result.stallNo} has ended. Nothing can be collected on this card.`;
  }
}

const camera = StyleSheet.create({
  frame: {
    height: 360,
    borderRadius: 4,
    overflow: "hidden",
    backgroundColor: color.ink,
  },
});
