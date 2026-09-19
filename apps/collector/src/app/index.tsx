import { Link } from "expo-router";
import { StyleSheet, Text, View } from "react-native";

/**
 * The app's entry point for Phase 3b-i.
 *
 * It lists the probes rather than a collector workflow, because at this point in the phase
 * there is no workflow yet: enrollment lands in Task 11, sign-in in Task 12, the shift in
 * Task 13. The probes stay afterwards -- they are the only things that will catch an
 * expo-sqlite or Hermes behaviour change on a future SDK upgrade.
 */
export default function Index() {
  return (
    <View style={styles.screen}>
      <Text style={styles.heading}>Device probes</Text>
      <Text style={styles.body}>
        Measurements that can only be taken on the real tablet. Each records a number the
        Phase 3b-i plan depends on.
      </Text>

      <Link href="/bcrypt-probe" style={styles.link}>
        bcrypt cost 12, under Hermes →
      </Link>

      <Link href="/engine-probe" style={styles.link}>
        The sync engine, on expo-sqlite →
      </Link>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: 24, gap: 16, backgroundColor: "#f8fafc" },
  heading: { fontSize: 22, fontWeight: "600", color: "#0f172a" },
  body: { fontSize: 14, lineHeight: 20, color: "#475569" },
  link: {
    fontSize: 16,
    color: "#1d4ed8",
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: "#e2e8f0",
  },
});
