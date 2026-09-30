import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { Text, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import {
  AtkinsonHyperlegible_400Regular,
  AtkinsonHyperlegible_700Bold,
  useFonts,
} from "@expo-google-fonts/atkinson-hyperlegible";
import { drizzle } from "drizzle-orm/expo-sqlite";
import { useMigrations } from "drizzle-orm/expo-sqlite/migrator";
import migrations from "../../drizzle/migrations";
import { openDeviceDb } from "../db/client";
import { color } from "../ui/tokens";
import { useLatestUpdate } from "../updates/useLatestUpdate";
import { useAutoSync } from "../sync/useAutoSync";

/**
 * A plain stack. No tabs, no theming scaffolding.
 *
 * The collector app's navigation is a sequence, not a set of peers: enroll, then sign in,
 * then a shift, then closeout. Phase 3b-i builds the spine of that sequence; 3b-ii fills in
 * the collection flow.
 *
 * THE NATIVE HEADER IS OFF AND `RackHead` IS THE TOP APP BAR. The native one cannot carry
 * the honest sync age that the lease and shift screens owe the collector in a fixed
 * position. System Back is untouched by
 * this: the hardware button and the predictive back gesture both work on a headerless
 * stack, and every screen that can be reached forwards also renders a labelled Back
 * control in the bar itself.
 *
 * The status bar is dark because it sits on the white app bar.
 */
export default function RootLayout() {
  // The update gate comes first so that a launch which reloads into a newer bundle does so
  // before migrating, and the migrations that run are the new bundle's.
  const upToDate = useLatestUpdate();
  if (!upToDate) return <View style={{ flex: 1, backgroundColor: color.ground }} />;
  return <MigratedRoot />;
}

function MigratedRoot() {
  // THE DEVICE SCHEMA IS MIGRATED HERE, BEFORE ANY SCREEN RENDERS. It used to happen only on
  // the enrol screen, so an already-enrolled tablet never received a new local migration --
  // and the next pull would then either fail or, since applyPull skips unknown columns,
  // quietly drop the new column's values. Nothing below may touch the database first.
  const { success, error } = useMigrations(drizzle(openDeviceDb()), migrations);
  // The faces are bundled assets, never fetched, so this resolves offline. A font that
  // fails to load is not a reason to hold the round: Android falls back to Roboto.
  const [fontsLoaded, fontError] = useFonts({
    AtkinsonHyperlegible_400Regular,
    AtkinsonHyperlegible_700Bold,
  });

  if (error) {
    return (
      <View style={{ flex: 1, justifyContent: "center", padding: 24, backgroundColor: color.ground }}>
        <Text style={{ color: color.ink }}>{`The tablet's database could not be updated: ${error.message}`}</Text>
      </View>
    );
  }
  if (!success || (!fontsLoaded && !fontError)) return <View style={{ flex: 1, backgroundColor: color.ground }} />;

  return (
    <SafeAreaProvider>
      {/*
        Dark icons, no backgroundColor: the app is edge-to-edge, so the status bar sits
        directly on `RackHead`, which paints the white bar up through the top inset. A
        backgroundColor here would draw a second, differently-timed strip over it.
      */}
      <StatusBar style="dark" />
      <AutoSync />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: color.ground },
        }}
      />
    </SafeAreaProvider>
  );
}

/**
 * A component rather than a hook call in MigratedRoot, because that one returns early while
 * the schema migrates -- and no sync may touch the database before it has.
 */
function AutoSync() {
  useAutoSync();
  return null;
}
