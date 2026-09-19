import { Stack } from "expo-router";

/**
 * A plain stack. No tabs, no theming scaffolding.
 *
 * The collector app's navigation is a sequence, not a set of peers: enroll, then sign in,
 * then a shift, then closeout. Phase 3b-i builds the spine of that sequence; 3b-ii fills in
 * the collection flow.
 */
export default function RootLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: "#0f172a" },
        headerTintColor: "#f8fafc",
      }}
    >
      <Stack.Screen name="index" options={{ title: "CEEDO Collector" }} />
      <Stack.Screen name="bcrypt-probe" options={{ title: "bcrypt under Hermes" }} />
      <Stack.Screen name="engine-probe" options={{ title: "Engine on expo-sqlite" }} />
      <Stack.Screen name="enroll" options={{ title: "Enrol this tablet" }} />
    </Stack>
  );
}
