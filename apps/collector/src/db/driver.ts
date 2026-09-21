import type { SQLiteDatabase } from "expo-sqlite";
import type { SqliteDriver } from "@ceedo/sync-engine";
import { openDeviceDb } from "./client";

/**
 * The device's driver. The other implementation of this interface is the Node one in
 * @ceedo/sync-engine/testing, and the two are the reason driver.ts's interface is
 * async-shaped: this one genuinely is.
 *
 * `withTransactionAsync` is used rather than hand-issued BEGIN/COMMIT because expo-sqlite
 * serialises access per connection and its own helper is what respects that. Issuing the
 * statements directly here would work until two syncs overlapped.
 */
export function expoSqliteDriver(db: SQLiteDatabase): SqliteDriver {
  const driver: SqliteDriver = {
    async execute(sql, params = []) {
      await db.runAsync(sql, params as never[]);
    },
    async select<T>(sql: string, params: readonly unknown[] = []) {
      return (await db.getAllAsync(sql, params as never[])) as T[];
    },
    async transaction<T>(fn: (tx: SqliteDriver) => Promise<T>): Promise<T> {
      let result!: T;
      await db.withTransactionAsync(async () => {
        result = await fn(driver);
      });
      return result;
    },
  };
  return driver;
}

let cached: SqliteDriver | null = null;

/**
 * The memoized device driver (ruling R11).
 *
 * `expoSqliteDriver` builds a fresh wrapper object on every call. Every screen used to call
 * it directly in its render body -- `expoSqliteDriver(openDeviceDb())` -- and some put the
 * result in a `useEffect`/`useCallback` dependency array. A new object identity every
 * render compares unequal to the last, so the effect never settles: it fires, the resulting
 * state update re-renders, the re-render builds a new driver, and the effect fires again,
 * forever. Against a connection this file's own comment above notes is serialised, that is
 * continuous SQLite traffic through an entire shift -- battery drain and sluggishness
 * rather than a crash, which is why device smoke testing never caught it.
 *
 * The driver holds no per-screen state -- it only closes over `db`, which `openDeviceDb()`
 * already hands out as one stable singleton -- so one shared instance changes no behaviour
 * and settles the loop.
 */
export function deviceDriver(): SqliteDriver {
  if (!cached) cached = expoSqliteDriver(openDeviceDb());
  return cached;
}
