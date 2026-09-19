# bcrypt cost 12, under Hermes, on the tablet

**Status: MEASURED — and it fails the threshold by more than an order of magnitude.**
Median **47.0 seconds** in a debug build. Task 2's decision table calls this
"stop and escalate". Task 12 (offline sign-in) is BLOCKED until this is resolved.

**Date:** 2026-09-19
**Task:** Phase 3b-i plan, Task 2
**Probe:** `apps/collector/src/app/bcrypt-probe.tsx`

## Why this is measured before the sign-in screen exists

Spec §4.4 records what was already measured on the development machine:

| Implementation | Engine | cost-12 verify |
| --- | --- | --- |
| `pgcrypto` `crypt()` (C) | Postgres 15, Docker, Apple Silicon | ~184 ms |
| `bcryptjs` | Node 22 / V8, same machine | ~233 ms |

Only ~1.27× apart. **So the common claim that JavaScript bcrypt needs a native module is not
supported by measurement**, and this design does not assume one.

Hermes is the open variable. It has no JIT, and a tablet CPU is slower again than the
machine those figures came from. The plausible range is roughly 1.5–5 s, which is wide
enough to be an estimate rather than a finding — and if the real number lands past ~2 s the
sign-in design changes. Better known now than after the screens exist.

## How to take it

```bash
cd apps/collector
pnpm expo run:android --device
```

Open **bcrypt cost 12, under Hermes** from the home screen and press the button. It runs
five verifications against a real `set_collector_pin()` hash and reports every sample plus
the median.

The screen refuses to present a number as valid unless the runtime reports Hermes — a
measurement taken on JSC would not answer the question being asked. (The Android bundle
already builds as `.hbc`, Hermes bytecode, so this is expected to pass; the runtime check
is there because the build artefact and the execution engine are different claims.)

## Results

### Run 1 — debug build (`expo run:android --device`)

| Sample | 1 | 2 | 3 | 4 | 5 | Median |
| --- | --- | --- | --- | --- | --- | --- |
| ms | 36,356 | 45,526 | 47,360 | 47,008 | 49,963 | **47,008** |

- **Engine reported by the probe:** Hermes ✓
- **Build variant:** debug — see the caveat below, which is why this is labelled "Run 1"
  rather than "the answer".

**47 seconds to verify one PIN.** For comparison, on the development machine the same
`bcryptjs` code against the same hash took 233 ms under V8. That is a ~200× penalty, which
decomposes plausibly as roughly 30–60× for a no-JIT interpreter against a JIT on a tight
integer loop, times 3–4× for a tablet CPU against an M-series.

**The design estimate was 1.5–5 s and it was wrong by 10–30×.** Recording that plainly,
because the estimate's reasoning — "JS bcrypt is only 1.27× slower than C, so the engine is
the only open variable" — was sound about C-versus-JS and useless about JIT-versus-
interpreter. The 1.27× figure measured the wrong axis.

### The caveat that must be ruled out first

`expo run:android --device` builds the **debug** variant and serves JS from Metro with
`__DEV__` true. That is not what ships. Dev-mode React Native carries per-operation
overhead, and the bundle is not the ahead-of-time `.hbc` the release build uses.

A production-mode measurement is therefore required before treating 47 s as *the* number.
It will not rescue the situation on its own — even a 10× improvement leaves ~4.7 s, still
far past the 2 s threshold — but designing a remedy around a debug figure would be
measuring the wrong thing twice in a row, which is the mistake this file already records
once.

**Use a release build, not `expo start --no-dev --minify`.** The Metro route was tried
first and is the worse option for two reasons:

1. It still depends on the device reaching the dev server, and it failed in practice with
   `java.io.IOException: Failed to download remote update` -- a networking problem
   contributing nothing to the question being asked.
2. It measures production-mode JS on a debug native shell, still loading a bundle over the
   wire rather than the ahead-of-time `.hbc` that actually ships.

A release build compiles the JS into the APK, needs no Metro at all, and is what runs in
the field. It signs with the debug keystore out of the box -- `android/app/build.gradle`
sets `release { signingConfig signingConfigs.debug }` -- so no keystore setup is required
to take this measurement:

```bash
cd apps/collector
npx expo run:android --device --variant release
```

### Run 2 — release build

| Sample | 1 | 2 | 3 | 4 | 5 | Median |
| --- | --- | --- | --- | --- | --- | --- |
| ms | — | — | — | — | — | **—** |

## The options, with what each costs

None of these is free, and the choice is a security-posture decision rather than a
performance tweak — see "Context for whoever reads this later" at the end.

**A — a native bcrypt binding.** Keeps spec D3's security property exactly as written: the
same cost-12 hash, verified in native code in a few hundred milliseconds. The project is
already building a custom dev client (`expo run:android`), and this phase already pulls in
`expo-sqlite`, `expo-secure-store` and `expo-camera`, so native modules cost no new
infrastructure here. The risk is supply: it needs a maintained JSI/turbo-module bcrypt that
works on current Expo, and that must be verified rather than assumed.

**B — lower the cost factor.** Each step down halves the work: cost 12 → 8 is ~16× (≈3 s,
still too slow), → 7 is ~32× (≈1.5 s), → 6 is ~64× (≈730 ms). But cost is the *only*
mitigation the PIN has. At cost 12, exhausting 10^6 PINs takes an attacker days; at cost 6
it is well under an hour on a decent machine. This is a real reduction in the one control
behind PIN attribution, and it needs deciding as such.

**C — a different KDF with native support.** For example PBKDF2-SHA256 through a native
module, which is fast on-device and tunable against attackers. But `set_collector_pin`
would have to stop producing bcrypt hashes, and `pgcrypto` has no PBKDF2 — so this reaches
back into the server and into migration `0027`. Larger change, and it re-opens a decision
spec D3 already made.

**D — do not verify the PIN with a slow KDF at all.** Treat the synced hash as an
attribution check rather than a cracking-resistant secret. Honest about what §11.5 already
says — *"the PIN is not the security boundary, the booklet is"* — but it contradicts D3's
explicit reasoning that cost is the only mitigation, so it cannot be adopted quietly.

## Decision

Task 2, Step 5. Record which branch was taken and why.

| Median | Decision | Taken? |
| --- | --- | --- |
| under ~800 ms | Proceed as specified. No progress indicator needed on sign-in. | — |
| ~800 ms – 2 s | Proceed, but Task 12's sign-in shows a progress indicator during verification. | — |
| over ~2 s | **Stop and escalate.** Options are a native bcrypt binding or a cost-factor conversation with the ordinance in hand. Both are decisions for a human. | — |

## Context for whoever reads this later

The PIN is a ~20-bit secret (10^6 combinations) and bcrypt cost 12 is the *only* mitigation
against offline cracking, because the hash is synced to the device and a stolen tablet is an
offline target. Spec D3 sets out the reasoning, and §11.5's own position is that **the PIN is
not the security boundary — the booklet is.**

So a decision to lower the cost factor is not a performance tweak; it is a change to the one
control standing behind an attribution mechanism. It needs stating in those terms, not as
"sign-in felt slow".
