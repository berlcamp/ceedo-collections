import { useRouter } from "expo-router";
import { Body, Group, Label, Punch, RackHead, Rift, Rule, Screen, Slot } from "../ui";

/**
 * The app's entry point.
 *
 * It lists the route a tablet takes from the office to a market round, plus the two
 * probes. The probes stay -- they are the only things that will catch an expo-sqlite or
 * Hermes behaviour change on a future SDK upgrade -- but they are filed below the work
 * rather than above it, because a collector opening this app is not looking for them.
 */
export default function Index() {
  const router = useRouter();

  return (
    <Screen
      head={<RackHead title="CEEDO Collector" subtitle="Market collections" />}
      shelf={<Punch label="Sign in" onPress={() => router.push("/sign-in")} />}
    >
      <Group>
        <Label>The route</Label>
        <Body>
          A tablet is enrolled once at the office, then signed into at the start of every
          round. Everything after that works without signal.
        </Body>
      </Group>

      <Rift h={24} />

      <Rule />
      <Slot onPress={() => router.push("/enroll")} left="Enrol this tablet" />
      <Rule />
      <Slot onPress={() => router.push("/sign-in")} left="Sign in" />
      <Rule />

      <Rift />

      <Group>
        <Label>Device probes</Label>
        <Body>
          Measurements that can only be taken on the real tablet. Not part of a round.
        </Body>
      </Group>
      <Rift h={16} />
      <Rule />
      <Slot onPress={() => router.push("/bcrypt-probe")} left="bcrypt cost 12, under Hermes" />
      <Rule />
      <Slot onPress={() => router.push("/engine-probe")} left="The sync engine, on expo-sqlite" />
      <Rule />
    </Screen>
  );
}
