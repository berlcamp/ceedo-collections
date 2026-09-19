import { useState } from "react";
import { Button, Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import bcrypt from "bcryptjs";

/**
 * A THROWAWAY screen with one job: how long does bcrypt cost-12 verification take under
 * Hermes, on the real tablet?
 *
 * WHY THIS IS MEASURED BEFORE THE SIGN-IN SCREEN EXISTS. Spec §4.4 records what was already
 * measured on the development machine: native C bcrypt at cost 12 is ~184ms and bcryptjs on
 * V8 is ~233ms -- only ~1.27x apart. So the common claim that JavaScript bcrypt needs a
 * native module is NOT supported by measurement, and the design does not assume one.
 *
 * Hermes is the open variable. It has no JIT, and a tablet CPU is slower again than the
 * machine those numbers came from. If verification lands past ~2s the sign-in design changes
 * -- a native binding, or a cost-factor conversation -- and that is a decision for whoever
 * holds the number, not something to discover after the screens are built.
 *
 * Delete this screen in Task 12 once the number is recorded in
 * docs/superpowers/measurements/phase-3b-i-bcrypt-hermes.md.
 */

/**
 * A real `crypt('123456', gen_salt('bf', 12))` output from this project's Postgres, so this
 * measures exactly what set_collector_pin() produces -- not a hash from some other tool at
 * some other cost factor.
 */
const HASH = "$2a$12$uDaaR3AzzqrwJB1WnEJwY.u2dqVzFqIkM/4M23P.f2g05aNMcMuau";
const PIN = "123456";
const SAMPLES = 5;

/**
 * A measurement taken on JSC would be meaningless -- Hermes is what ships. Checked at
 * runtime rather than assumed from app.json, because the engine is what is actually
 * executing this code.
 */
function engineName(): string {
  return (globalThis as { HermesInternal?: unknown }).HermesInternal
    ? "Hermes"
    : `NOT Hermes (${Platform.OS})`;
}

export default function BcryptProbe() {
  const [lines, setLines] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const engine = engineName();
  const onHermes = engine === "Hermes";

  function run() {
    setRunning(true);
    const samples: number[] = [];

    for (let i = 0; i < SAMPLES; i++) {
      const started = Date.now();
      // The CORRECT pin, so the full key schedule runs to completion. A wrong PIN costs the
      // same in bcrypt by design, but measuring the success path removes any doubt about
      // whether an early exit was being timed.
      const ok = bcrypt.compareSync(PIN, HASH);
      samples.push(Date.now() - started);

      if (!ok) {
        setLines(["HASH MISMATCH — the probe is wrong, not the timing."]);
        setRunning(false);
        return;
      }
    }

    const sorted = [...samples].sort((a, b) => a - b);
    const median = sorted[Math.floor(SAMPLES / 2)] ?? 0;

    setLines([
      `engine:  ${engine}`,
      `samples: ${samples.join(", ")} ms`,
      `median:  ${median} ms`,
      "",
      verdict(median),
    ]);
    setRunning(false);
  }

  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <View style={[styles.banner, onHermes ? styles.ok : styles.warn]}>
        <Text style={styles.bannerText}>
          {onHermes
            ? "Running on Hermes — this measurement is valid."
            : `Engine reports "${engine}". A number taken here does NOT answer the question; ` +
              "fix the Expo configuration before recording anything."}
        </Text>
      </View>

      <Text style={styles.body}>
        Verifies a cost-12 bcrypt hash {SAMPLES} times and reports the median. The hash is a
        real `set_collector_pin()` output.
      </Text>

      <Button
        title={running ? "Running…" : `Run ${SAMPLES} verifications`}
        onPress={run}
        disabled={running}
      />

      {lines.length > 0 ? (
        <View style={styles.results}>
          {lines.map((line, i) => (
            <Text key={`${i}-${line}`} selectable style={styles.mono}>
              {line}
            </Text>
          ))}
        </View>
      ) : null}
    </ScrollView>
  );
}

/**
 * The decision table from the Phase 3b-i plan, Task 2 Step 5, rendered on the device so the
 * person holding it does not have to go and look it up.
 */
function verdict(median: number): string {
  if (median < 800) {
    return "UNDER 800ms — proceed as specified. No progress indicator needed on sign-in.";
  }
  if (median <= 2000) {
    return "800ms–2s — proceed, but Task 12's sign-in must show a progress indicator.";
  }
  return (
    "OVER 2s — STOP AND ESCALATE. The options are a native bcrypt binding or a " +
    "cost-factor conversation, and both are decisions for a human."
  );
}

const styles = StyleSheet.create({
  screen: { padding: 24, gap: 16 },
  banner: { padding: 12, borderRadius: 8 },
  ok: { backgroundColor: "#dcfce7" },
  warn: { backgroundColor: "#fee2e2" },
  bannerText: { fontSize: 13, lineHeight: 18, color: "#0f172a" },
  body: { fontSize: 14, lineHeight: 20, color: "#475569" },
  results: { gap: 4, padding: 12, backgroundColor: "#0f172a", borderRadius: 8 },
  mono: {
    fontFamily: Platform.select({ android: "monospace", default: "Menlo" }),
    fontSize: 13,
    color: "#e2e8f0",
  },
});
