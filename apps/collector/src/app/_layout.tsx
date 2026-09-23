import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { Text, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { drizzle } from "drizzle-orm/expo-sqlite";
import { useMigrations } from "drizzle-orm/expo-sqlite/migrator";
import migrations from "../../drizzle/migrations";
import { openDeviceDb } from "../db/client";
import { color } from "../ui/tokens";

/**
 * A plain stack. No tabs, no theming scaffolding.
 *
 * The collector app's navigation is a sequence, not a set of peers: enroll, then sign in,
 * then a shift, then closeout. Phase 3b-i builds the spine of that sequence; 3b-ii fills in
 * the collection flow.
 *
 * THE NATIVE HEADER IS OFF AND `RackHead` IS THE TOP APP BAR. Two bars in the rack's teal
 * would be two bars, and the native one cannot carry the honest sync age that the lease
 * and shift screens owe the collector in a fixed position. System Back is untouched by
 * this: the hardware button and the predictive back gesture both work on a headerless
 * stack, and every screen that can be reached forwards also renders a labelled Back
 * control in the bar itself.
 *
 * The status bar is light because it sits on the rack board.
 */
export default function RootLayout() {
  // THE DEVICE SCHEMA IS MIGRATED HERE, BEFORE ANY SCREEN RENDERS. It used to happen only on
  // the enrol screen, so an already-enrolled tablet never received a new local migration --
  // and the next pull would then either fail or, since applyPull skips unknown columns,
  // quietly drop the new column's values. Nothing below may touch the database first.
  const { success, error } = useMigrations(drizzle(openDeviceDb()), migrations);

  if (error) {
    return (
      <View style={{ flex: 1, justifyContent: "center", padding: 24, backgroundColor: color.stock }}>
        <Text style={{ color: color.ink }}>{`The tablet's database could not be updated: ${error.message}`}</Text>
      </View>
    );
  }
  if (!success) return <View style={{ flex: 1, backgroundColor: color.stock }} />;

  return (
    <SafeAreaProvider>
      {/*
        Light icons, no backgroundColor: the app is edge-to-edge, so the status bar sits
        directly on `RackHead`, which paints the rack board up through the top inset. A
        backgroundColor here would draw a second, differently-timed strip over it.
      */}
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: color.stock },
        }}
      />
    </SafeAreaProvider>
  );
}
