# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.

# When does a change need a native rebuild?

`pnpm expo run:android --device` is a Gradle build. Most changes do not need one, and
running it out of habit turns a two-second reload into a two-minute wait.

**Reload the app** (shake -> Reload, or `r` in the Metro terminal). Nothing else:
- anything under `src/` -- screens, `src/db`, `src/auth`, `src/sync`
- `packages/shared`, `packages/db-local`, `packages/sync-engine`
- `drizzle/` migrations. They are inlined into the bundle by `babel-plugin-inline-import`
  and applied at runtime by `useMigrations`, so a new one lands on reload.
- a new dependency with no native code

**Restart Metro** (`pnpm expo start --clear`), then reload:
- `.env` -- `EXPO_PUBLIC_*` values are inlined at BUNDLE time, so a running Metro keeps
  serving the old ones. No Gradle build is needed, but a plain reload is not enough either.
- `metro.config.js`, `babel.config.js`

**Full `expo run:android`**, because the APK itself changes:
- a new dependency WITH native code (`expo-camera`, `expo-secure-store`, `expo-sqlite`,
  `expo-crypto` all were)
- `modules/ceedo-bcrypt` -- Kotlin. Fast Refresh does not reload Kotlin, and the failure
  mode is silent: the module simply reports unavailable.
- `app.json` plugins or permissions
- anything under `android/`

The rule in one line: **if it ends up in the JS bundle, reload; if it ends up in the APK,
rebuild.**

# Shipping a JS change to tablets: EAS Update (OTA)

Tablets running an `eas build` APK pull JS updates from their build's channel (`preview` or
`production`, see `eas.json`). The same one-line rule decides: **bundle changes ship over
the air; APK changes need a new `eas build -p android --profile <channel>`.**

```bash
pnpm ota:preview --message "..."      # test tablets first
pnpm ota:production --message "..."   # every collector's tablet
```

- **Never run a bare `eas update`.** `EXPO_PUBLIC_*` are inlined at bundle time, and without
  `--environment` they come from the local `.env`, which points at a Mac on the LAN. Every
  tablet would start syncing to it. The `ota:*` scripts pass the matching environment.
- **`runtimeVersion` is `fingerprint`.** Any native change (a native dependency, `modules/`,
  `app.json` plugins or permissions) changes the fingerprint, so older APKs simply stop
  receiving updates instead of crashing on JS that expects native code they lack. That also
  means an OTA published after a native change reaches only APKs built after it.
- **`drizzle/` migrations ride the OTA** and run on the next launch, against tablets that may
  hold receipts not yet synced. Ship them to `preview` and verify on a test tablet before
  production.
- A tablet downloads an update on launch and applies it on the launch after, so a collector
  may need to close and reopen the app twice.
