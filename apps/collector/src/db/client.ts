import { openDatabaseSync, type SQLiteDatabase } from "expo-sqlite";

let handle: SQLiteDatabase | null = null;

/**
 * One database for the life of the app.
 *
 * `defer_foreign_keys` is set per connection rather than per transaction: the pull applies
 * 17 tables in one transaction, and their foreign keys are only consistent once the whole
 * envelope has landed. The alternative is a hand-maintained topological insert order across
 * seventeen tables, which would have to be corrected every time the server adds one.
 */
export function openDeviceDb(): SQLiteDatabase {
  if (handle) return handle;
  handle = openDatabaseSync("ceedo.db");
  handle.execSync("pragma foreign_keys = on; pragma defer_foreign_keys = on;");
  return handle;
}
