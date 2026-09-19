import type { SQLiteDatabase } from "expo-sqlite";
import type { SqliteDriver } from "@ceedo/sync-engine";

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
