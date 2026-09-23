import { useCallback, useState } from "react";
import { useFocusEffect, useRouter } from "expo-router";
import { ScrollView, View } from "react-native";
import { Action, Body, Field, Note, RackHead, Register, Rule, Screen, Slot, Title, color } from "../ui";
import { freshness, type Freshness } from "../ui/staleness";
import { businessDate } from "../sync/device-sync";
import { deviceDriver } from "../db/driver";
import { signedIn } from "../auth/session";

interface LeaseHit {
  lease_id: string;
  stall_no: string;
  tenant_name: string;
  section_name: string | null;
}

/**
 * Search by stall number or tenant name.
 *
 * NOT a fallback. Parent §9.4 makes manual search mandatory in its own right: cards get
 * soaked, torn, peeled off and stolen, and a collection system that stalls on an
 * unreadable card fails on its first morning. Phase 4's QR scan is an accelerator laid
 * over this screen, which must already work.
 *
 * Scoped by construction rather than by a predicate: sync_pull only ever sent this device
 * the leases inside its own assignment, so there is nothing here to filter out.
 */
export default function Leases() {
  const router = useRouter();
  const driver = deviceDriver();
  const collector = signedIn();

  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<LeaseHit[]>([]);
  const [fresh, setFresh] = useState<Freshness | null>(null);

  const search = useCallback(
    async (text: string) => {
      const term = `%${text.trim().toLowerCase()}%`;
      const rows = await driver.select<LeaseHit>(
        `select l.id as lease_id, s.stall_no, t.full_name as tenant_name,
                sec.name as section_name
           from leases l
           join stalls s on s.id = l.stall_id
           join tenants t on t.id = l.tenant_id
           left join sections sec on sec.id = s.section_id
          where l.status = 'active'
            and (lower(s.stall_no) like ? or lower(t.full_name) like ?)
          order by s.stall_no
          limit 50`,
        [term, term],
      );
      setHits(rows);
      setFresh(await freshness(driver, businessDate()));
    },
    [driver],
  );

  useFocusEffect(
    useCallback(() => {
      void search("");
    }, [search]),
  );

  if (!collector) {
    return (
      <Screen head={<RackHead title="Collect" onBack={() => router.back()} />}>
        <Note>Sign in first.</Note>
      </Screen>
    );
  }

  return (
    <Screen
      scroll={false}
      head={
        <RackHead
          title="Collect"
          subtitle={`${hits.length} lease${hits.length === 1 ? "" : "s"} on this tablet`}
          onBack={() => router.back()}
          register={fresh ? <Register state={fresh.state} detail={fresh.short} /> : undefined}
        />
      }
    >
      <Action label="Scan a tenant card instead" tone="quiet" onPress={() => router.push("/scan")} />

      <View style={{ height: 16 }} />

      <Field
        label="Stall number or tenant name"
        placeholder="Search"
        autoCorrect={false}
        value={query}
        onChangeText={(text) => {
          setQuery(text);
          void search(text);
        }}
      />

      <View style={{ height: 16 }} />

      {hits.length === 0 ? (
        <Note>
          {query.trim() === ""
            ? "No leases on this tablet yet. Sync from the shift screen."
            : `Nothing matches "${query.trim()}".`}
        </Note>
      ) : (
        <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled">
          <Rule />
          {hits.map((hit) => (
            <View key={hit.lease_id}>
              <Slot
                onPress={() => router.push(`/lease/${hit.lease_id}`)}
                left={
                  <View style={{ gap: 2 }}>
                    {/*
                      The stall number leads, at the screen's title scale. A collector
                      walking a row of stalls is matching a number painted on a stall
                      front, at arm's length, in sun -- the tenant name underneath is how
                      they confirm they matched the right one, not how they find it.
                    */}
                    <Title numberOfLines={1}>{hit.stall_no}</Title>
                    <Body>{hit.tenant_name}</Body>
                    {hit.section_name ? (
                      <Body tone={color.muted}>{hit.section_name}</Body>
                    ) : null}
                  </View>
                }
              />
              <Rule />
            </View>
          ))}
        </ScrollView>
      )}
    </Screen>
  );
}
