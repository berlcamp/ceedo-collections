import { useRouter } from "expo-router";
import { Body, Card, Group, Label, List, Punch, RackHead, Rift, Screen, Slot } from "../ui";

/**
 * The app's entry point: the route a tablet takes from the office to a market round.
 *
 * The two device probes (`/bcrypt-probe`, `/engine-probe`) are no longer linked from here.
 * They stay in the app, development builds only, because they are the only things that
 * will catch an expo-sqlite or Hermes behaviour change on a future SDK upgrade. Open one
 * on a dev build with:
 *
 *   adb shell am start -a android.intent.action.VIEW -d "ceedo-collector://engine-probe"
 */
export default function Index() {
  const router = useRouter();

  return (
    <Screen
      head={<RackHead title="CEEDO Collector" subtitle="Market collections" icon="storefront-outline" />}
      shelf={<Punch label="Sign in" icon="login" onPress={() => router.push("/sign-in")} />}
    >
      <Card>
        <Label>The route</Label>
        <Body>
          A tablet is enrolled once at the office, then signed into at the start of every
          round. Everything after that works without signal.
        </Body>
      </Card>

      <Rift h={24} />

      <List>
        <Slot
          icon="tablet-cellphone"
          nav
          onPress={() => router.push("/enroll")}
          left={
            <Group gap={2}>
              <Body>Enrol this tablet</Body>
              <Label>Once, at the office</Label>
            </Group>
          }
        />
        <Slot
          icon="account-key-outline"
          nav
          onPress={() => router.push("/sign-in")}
          left={
            <Group gap={2}>
              <Body>Sign in</Body>
              <Label>Start of every round</Label>
            </Group>
          }
        />
      </List>
    </Screen>
  );
}
