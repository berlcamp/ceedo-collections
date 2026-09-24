import { useRouter } from "expo-router";
import { Body, Card, Group, Label, List, Punch, RackHead, Rift, Screen, Slot, color } from "../ui";

/**
 * The app's entry point.
 *
 * It lists the route a tablet takes from the office to a market round, plus -- in
 * development builds only -- the two probes. The probes stay because they are the only
 * things that will catch an expo-sqlite or Hermes behaviour change on a future SDK
 * upgrade, but a production tablet never shows them.
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

      {/*
        DEVELOPMENT BUILDS ONLY. The engine probe writes 1,500 fake charges into the real
        local tables and moves the sync cursor, so on a production tablet one curious tap
        would leave the device's mirror wrong. `__DEV__` is false in every EAS build.
      */}
      {__DEV__ ? (
        <>
          <Rift />

          <Group gap={4}>
            <Label>Device probes</Label>
            <Body tone={color.muted}>
              Measurements that can only be taken on the real tablet. Not part of a round.
            </Body>
          </Group>
          <Rift h={12} />
          <List>
            <Slot
              icon="speedometer"
              nav
              onPress={() => router.push("/bcrypt-probe")}
              left="bcrypt cost 12, under Hermes"
            />
            <Slot
              icon="database-sync-outline"
              nav
              onPress={() => router.push("/engine-probe")}
              left="The sync engine, on expo-sqlite"
            />
          </List>
        </>
      ) : null}
    </Screen>
  );
}
