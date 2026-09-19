import { defineConfig } from "drizzle-kit";

/**
 * `driver: 'expo'` makes drizzle-kit emit migrations that bundle into the app and apply
 * through `useMigrations` at startup, rather than migrations run against a live URL. The
 * Node test driver replays the same generated SQL, so both ends share one schema history.
 */
export default defineConfig({
  dialect: "sqlite",
  driver: "expo",
  schema: "./src/schema.ts",
  out: "./drizzle",
});
