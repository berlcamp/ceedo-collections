import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
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
