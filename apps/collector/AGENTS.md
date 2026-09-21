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
