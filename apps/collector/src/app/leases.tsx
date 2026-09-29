import { useCallback, useState } from "react";
import { useFocusEffect, useRouter } from "expo-router";
import { ScrollView, View } from "react-native";
import { Action, Body, Field, List, Note, RackHead, Register, Screen, Slot, Title, color } from "../ui";
import { freshness, type Freshness } from "../ui/staleness";
import { businessDate } from "../sync/device-sync";
import { deviceDriver } from "../db/driver";
import { IN_COLLECTOR_AREA } from "@ceedo/sync-engine";
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
 * Scoped to the signed-in collector's collection area (IN_COLLECTOR_AREA): every tablet
 * holds every facility's leases, so the area is what keeps a collector to their own stalls.
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
            and ${IN_COLLECTOR_AREA}
            and (lower(s.stall_no) like ? or lower(t.full_name) like ?)
          order by s.stall_no
          limit 50`,
        [collector?.id ?? "", term, term],
      );
      setHits(rows);
      setFresh(await freshness(driver, businessDate()));
    },
    [collector, driver],
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
      <Field
        icon="magnify"
        label="Stall number or tenant name"
        placeholder="Search"
        autoCorrect={false}
        value={query}
        onChangeText={(text) => {
          setQuery(text);
          void search(text);
        }}
      />

      <View style={{ height: 12 }} />
      <Action
        label="Scan a tenant card instead"
        icon="qrcode-scan"
        onPress={() => router.push("/scan")}
      />
      <View style={{ height: 16 }} />

      {hits.length === 0 ? (
        <Note icon={query.trim() === "" ? "store-off-outline" : "text-search"}>
          {query.trim() === ""
            ? "No leases on this tablet yet. Sync from the shift screen."
            : `Nothing matches "${query.trim()}".`}
        </Note>
      ) : (
        <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled">
          <List>
            {hits.map((hit) => (
              <Slot
                key={hit.lease_id}
                icon="storefront-outline"
                nav
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
            ))}
          </List>
          <View style={{ height: 24 }} />
        </ScrollView>
      )}
    </Screen>
  );
}
