# CEEDO Collections

A market-collections system for a Philippine LGU: a Next.js back office (`apps/web`), an
offline-first Expo collector app for Android tablets (`apps/collector`), and a Supabase
(Postgres + Edge Functions) backend under `supabase/`.

```bash
pnpm install
supabase start
supabase db reset
pnpm test
pnpm typecheck
```

## This project runs on non-default Supabase ports

**`supabase/config.toml` declares ports in the 563xx range, not Supabase's 543xx
defaults.** More than one Supabase stack runs alongside this one on the machine it was
built on, and this project does not own the defaults. The defaults were declared while the
containers actually ran elsewhere, and the split stayed invisible until `supabase db reset`
rebuilt the database container from `config.toml`, hit `port is already allocated`, and
left the whole stack down.

| Service   | Port    |
| --------- | ------- |
| API       | `56321` |
| Database  | `56322` |
| Shadow DB | `56320` |
| Studio    | `56323` |
| Inbucket  | `56324` |
| Analytics | `56327` |
| Pooler    | `56329` |

Consequences worth knowing before you debug something else:

- **Anything that hardcodes `127.0.0.1:54321` or `:54322` will silently reach nothing.**
  That already cost CI a full readiness-poll timeout reported as "Edge Functions did not
  become ready", when the Functions were fine and the port was wrong. Read the port from
  `supabase status -o env` (`API_URL`, `DB_URL`) instead of writing one down. The fallbacks
  in `tests/helpers/*` still name the 543xx defaults, so they are a fallback for a stack on
  default ports, never the value this project runs against.
- **Google sign-in needs the port registered with Google, not just here.** Supabase's OAuth
  callback is `<API_URL>/auth/v1/callback`, so moving the API port changes the redirect URI
  Google is asked to honour. The CEEDO OAuth client (APIs & Services → Credentials) must
  list:

  ```
  http://127.0.0.1:56321/auth/v1/callback
  ```

  Without it Google answers **"Access blocked: This app's request is invalid"** before
  Supabase is ever reached. Keep the old `54321` entry alongside it — an extra authorized
  URI costs nothing and keeps an older checkout working.

  Worse than the outright block: with the web app pointed at `54321` while ANOTHER project
  answers there, sign-in *succeeds* against that project's GoTrue and the app then reports
  **"not registered with CEEDO Collections. Ask an administrator to add your email
  address."** Every word of that is true and none of it mentions a port. If you see it,
  check `NEXT_PUBLIC_SUPABASE_URL` before you check the invite.

- **Check what is actually listening before blaming the code:**

  ```bash
  docker ps --format '{{.Names}}\t{{.Ports}}' | grep supabase
  ```

  Containers for this project publish 563xx. A container answering on 543xx belongs to a
  different project, and pointing this suite at it will produce failures that look like
  schema drift.

- **If you run only this project**, the ports are still fine; nothing about 563xx requires
  a second stack. Change them only if they collide on your machine, and change them in
  `config.toml` — that file is what `supabase start`, `supabase db reset` and
  `supabase status` all read, so it is the single place the containers and the tooling can
  agree.

## Running the suite

`pnpm test` (never a bare `vitest run` — the workspace projects matter). **Run
`supabase db reset` before any full run you intend to trust:** the suite does not clean up
between files, and an accumulated database produces failures in tests that never touched
the rows causing them.

`apps/collector` is not in the vitest workspace. Its screens are verified by
`pnpm typecheck` and:

```bash
cd apps/collector && npx expo export --platform android
```

## Layout

| Path                   | What it is                                                     |
| ---------------------- | -------------------------------------------------------------- |
| `apps/web`             | Next.js back office                                              |
| `apps/collector`       | Expo / React Native collector app                                |
| `packages/shared`      | Pure domain logic and the sync contract. No I/O, no React Native |
| `packages/sync-engine` | Device sync, outbox, ledger overlay. No React Native or Expo     |
| `packages/db-local`    | The device's SQLite schema and migrations                        |
| `supabase/`            | Migrations, Edge Functions, local stack config                   |
| `tests/`               | The database and HTTP suites, run against the local stack        |
| `docs/superpowers/`    | Specs, plans and phase handovers                                 |
</content>
