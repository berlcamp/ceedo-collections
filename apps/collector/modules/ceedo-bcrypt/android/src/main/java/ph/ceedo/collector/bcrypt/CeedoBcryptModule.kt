package ph.ceedo.collector.bcrypt

import at.favre.lib.crypto.bcrypt.BCrypt
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.nio.charset.StandardCharsets

/**
 * Native bcrypt verification for offline collector PIN sign-in.
 *
 * WHY THIS MODULE EXISTS AT ALL. The collector app verifies a `$2a$12$` hash produced by
 * `set_collector_pin()` (`crypt(pin, gen_salt('bf', 12))`, migration 0027) entirely offline,
 * because §11.5 rules out any authentication needing a network round trip: "a 5am market
 * round that cannot begin is a collector sent home."
 *
 * Measured on the target tablet, in a release build, with `bcryptjs` under Hermes:
 *
 *     median 22,265 ms          (5 samples, 0.2% spread)
 *
 * Against a 2,000 ms threshold and an 800 ms goal. Hermes has no JIT, and bcrypt at cost 12
 * is ~4,096 Blowfish key expansions of pure 32-bit integer arithmetic -- exactly the
 * workload an interpreter cannot make fast. There is no JavaScript fix: 22.3 s IS the
 * optimised, minified, ahead-of-time-compiled result, and Hermes has no WebAssembly either.
 *
 * Java runs under ART, which is JIT-compiled, so the same work belongs on this side of the
 * bridge. Full reasoning and every measurement:
 * docs/superpowers/measurements/phase-3b-i-bcrypt-hermes.md
 *
 * WHY A LOCAL MODULE RATHER THAN AN NPM PACKAGE. Every published native bcrypt for React
 * Native was checked against live npm and GitHub and every one was unusable: the best
 * candidate has 0 stars and a Nitro version skew, the next is two years dead with an
 * unanswered "does not register on Android" bug at RN 0.80, another still declares
 * `jcenter()`, and one is pure JavaScript from 2016. Depending on any of them for the code
 * path that authenticates every collector on every shift is a worse risk than writing these
 * fifty lines.
 *
 * WHY at.favre.lib:bcrypt RATHER THAN VENDORED jBCrypt. jBCrypt is a single file and has not
 * been released since 2010; vendoring it means owning 800 lines of crypto and inheriting its
 * known quirks. `at.favre.lib:bcrypt` is Apache 2.0, actively maintained, tested, parses
 * Modular Crypt Format itself, and handles the `2x`/null-byte edge cases jBCrypt is known
 * for. A pinned Maven dependency in the Java ecosystem is a different risk profile from an
 * abandoned npm wrapper.
 */
class CeedoBcryptModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("CeedoBcrypt")

    /**
     * Verifies a PIN against a bcrypt hash. Returns false for any malformed input rather
     * than throwing.
     *
     * DELIBERATELY SYNCHRONOUS. The call blocks the JS thread for its duration, which is the
     * right trade here: verification happens once per sign-in, the expected cost is a few
     * hundred milliseconds, and a synchronous answer keeps the caller free of a promise that
     * could interleave with a second sign-in attempt. If measurement shows otherwise, the
     * fix is AsyncFunction, not a cost-factor change.
     *
     * NEVER THROWS ON A BAD HASH. A collector with a malformed or absent `pin_hash` must
     * reach sign-in's own "PIN not set" branch, which says what to do about it; an exception
     * here would surface as a crash or a generic failure instead. §6.3 records the real
     * consequence of getting that wrong -- a supervisor who resets a PIN believing it takes
     * effect immediately has sent a collector out unable to work, and a generic error makes
     * that undiagnosable in the field.
     */
    Function("verify") { pin: String, hash: String ->
      if (pin.isEmpty() || hash.isEmpty()) return@Function false

      try {
        val result = BCrypt.verifyer().verify(
          pin.toByteArray(StandardCharsets.UTF_8),
          hash.toByteArray(StandardCharsets.UTF_8),
        )
        result.verified
      } catch (_: IllegalArgumentException) {
        // Raised for a hash that is not valid Modular Crypt Format. Not an error worth
        // propagating: an unparseable hash is indistinguishable, to the collector, from a
        // PIN that was never set.
        false
      }
    }

    /**
     * Reports the cost factor encoded in a hash, or -1 if it cannot be read.
     *
     * Exists so the device can assert what it was given rather than trust it. Spec D3 makes
     * cost the PIN's ONLY mitigation -- ~20 bits of entropy, so a cheap hash is a cracking
     * target on a tablet that may be stolen -- and a server that silently started issuing
     * cost 6 would be invisible to every other check in this system.
     */
    Function("costOf") { hash: String ->
      // MCF: $2a$12$<22-char salt><31-char hash>. The cost is the third field.
      val parts = hash.split("$")
      if (parts.size < 4) -1 else parts[2].toIntOrNull() ?: -1
    }
  }
}
