import { useState } from "react";
import { Button, Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import bcrypt from "bcryptjs";
// Relative, not the `@/modules/...` alias the Expo docs show: this project already maps
// `@/*` to `./src/*`, so that alias would resolve to src/modules/ and silently miss.
import { verify as nativeVerify, costOf, EXPECTED_COST } from "../../modules/ceedo-bcrypt";

/**
 * Measures bcrypt cost-12 verification on the real tablet, native against JavaScript.
 *
 * WHAT THIS ALREADY SETTLED. `bcryptjs` under Hermes measured a median of 22,265 ms in a
 * release build (5 samples, 0.2% spread) against a 2,000 ms threshold. Hermes has no JIT and
 * bcrypt is ~4,096 rounds of pure integer arithmetic, so there is no JavaScript fix -- that
 * figure IS the minified, ahead-of-time-compiled result, and Hermes has no WebAssembly
 * either. Hence `modules/ceedo-bcrypt`, which does the same work in Java under ART.
 *
 * It keeps BOTH paths on purpose. The native number alone would be a claim; the two side by
 * side on one device in one run are a comparison, and the ratio is the thing worth carrying
 * into the handover.
 *
 * WHY THIS SCREEN STAYS after Task 12, rather than being deleted as originally planned: it
 * is the only thing that will catch a future Expo SDK upgrade silently unlinking the native
 * module and sending sign-in back down the 22-second path. It reports "NATIVE UNAVAILABLE"
 * rather than quietly falling through, which is the whole point.
 *
 * Measurements: docs/superpowers/measurements/phase-3b-i-bcrypt-hermes.md
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

  /**
   * Times `verify` over SAMPLES runs and returns the samples plus the median.
   *
   * Always verifies the CORRECT pin, so the full key schedule runs to completion. bcrypt
   * costs the same for a wrong password by design, but measuring the success path removes
   * any doubt that an early exit was being timed. A failed verification aborts rather than
   * reporting a number, because a fast wrong answer is worse than no answer.
   */
  function time(verify: () => boolean): { samples: number[]; median: number } | null {
    const samples: number[] = [];
    for (let i = 0; i < SAMPLES; i++) {
      const started = Date.now();
      const ok = verify();
      samples.push(Date.now() - started);
      if (!ok) return null;
    }
    const sorted = [...samples].sort((a, b) => a - b);
    return { samples, median: sorted[Math.floor(SAMPLES / 2)] ?? 0 };
  }

  function run() {
    setRunning(true);
    const out: string[] = [`engine:  ${engine}`];

    // NATIVE FIRST, because it is the one that decides whether this phase can proceed.
    // If the module is not linked, that is the finding -- and it must be reported as
    // "not linked", never silently fall through to the JS path and report its number as
    // though the native module had produced it.
    let native: ReturnType<typeof time> = null;
    try {
      const cost = costOf(HASH);
      out.push(`hash cost: ${cost}${cost === EXPECTED_COST ? "" : ` (EXPECTED ${EXPECTED_COST})`}`);
      native = time(() => nativeVerify(PIN, HASH));
      if (native === null) {
        out.push("NATIVE: verification returned false for the correct PIN — module is wrong.");
      } else {
        out.push(`native:  ${native.samples.join(", ")} ms`);
        out.push(`  median: ${native.median} ms`);
      }
    } catch (error) {
      out.push(`NATIVE UNAVAILABLE: ${String(error)}`);
      out.push("(A native module needs a rebuild — Fast Refresh does not reload Kotlin.)");
    }

    const js = time(() => bcrypt.compareSync(PIN, HASH));
    if (js === null) {
      out.push("JS: HASH MISMATCH — the probe is wrong, not the timing.");
    } else {
      out.push(`bcryptjs: ${js.samples.join(", ")} ms`);
      out.push(`  median: ${js.median} ms`);
    }

    if (native && js) {
      out.push("", `speedup: ${(js.median / native.median).toFixed(0)}x`);
    }
    if (native) {
      out.push("", verdict(native.median));
    }

    setLines(out);
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
        Verifies a cost-12 bcrypt hash {SAMPLES} times with the NATIVE module and {SAMPLES}
        times with bcryptjs, and reports both medians. The hash is a real
        `set_collector_pin()` output.
      </Text>

      <Button
        title={running ? "Running…" : "Run native vs bcryptjs"}
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
    "OVER 2s — STOP AND ESCALATE. The native module was supposed to be the answer to this, " +
    "so if NATIVE is over 2s the remaining options all change the security posture " +
    "(cost factor, or a different KDF) and are decisions for a human, not this plan."
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
