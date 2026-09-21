import { useCallback, useState } from "react";
import { useFocusEffect, useRouter } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { openDeviceDb } from "../db/client";
import { expoSqliteDriver } from "../db/driver";
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
  const driver = expoSqliteDriver(openDeviceDb());
  const collector = signedIn();

  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<LeaseHit[]>([]);

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
    },
    [driver],
  );

  useFocusEffect(
    useCallback(() => {
      void search("");
    }, [search]),
  );

  if (!collector) return <Text style={styles.note}>Sign in first.</Text>;

  return (
    <View style={styles.screen}>
      <TextInput
        style={styles.input}
        placeholder="Stall number or tenant name"
        autoCorrect={false}
        value={query}
        onChangeText={(text) => {
          setQuery(text);
          void search(text);
        }}
      />
      <ScrollView>
        {hits.length === 0 ? (
          <Text style={styles.note}>
            {query.trim() === ""
              ? "No leases on this tablet yet. Sync from the shift screen."
              : `Nothing matches "${query.trim()}".`}
          </Text>
        ) : (
          hits.map((hit) => (
            <Pressable
              key={hit.lease_id}
              style={styles.row}
              onPress={() => router.push(`/lease/${hit.lease_id}`)}
            >
              <Text style={styles.stall}>{hit.stall_no}</Text>
              <Text style={styles.tenant}>{hit.tenant_name}</Text>
              {hit.section_name ? (
                <Text style={styles.section}>{hit.section_name}</Text>
              ) : null}
            </Pressable>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: 16, gap: 12 },
  input: { borderWidth: 1, borderColor: "#999", borderRadius: 6, padding: 12, fontSize: 18 },
  row: { paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: "#eee" },
  stall: { fontSize: 22, fontWeight: "700" },
  tenant: { fontSize: 16 },
  section: { fontSize: 13, color: "#666" },
  note: { padding: 16, fontSize: 15, color: "#666" },
});
