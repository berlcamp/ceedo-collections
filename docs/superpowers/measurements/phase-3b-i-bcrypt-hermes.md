# bcrypt cost 12, under Hermes, on the tablet

**Status: NOT YET MEASURED.** This file exists so the number has somewhere to go, and so
nobody mistakes its absence for a measurement that came back fine. Task 12 (offline sign-in)
reads the Results section below and must not start until it holds real figures.

**Date:** —
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

| Sample | 1 | 2 | 3 | 4 | 5 | Median |
| --- | --- | --- | --- | --- | --- | --- |
| ms | — | — | — | — | — | **—** |

- **Device model:** —
- **Android version:** —
- **Engine reported by the probe:** —

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
