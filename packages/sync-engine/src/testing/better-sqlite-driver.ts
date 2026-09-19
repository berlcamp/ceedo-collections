import type Database from "better-sqlite3";
import type { SqliteDriver } from "../driver";

/**
 * TEST-ONLY. The engine's Node-side driver.
 *
 * better-sqlite3 is synchronous, so every method here wraps a completed call in a resolved
 * promise. That is the easy direction, and it is why driver.ts insists the INTERFACE be
 * shaped to expo-sqlite instead: the reverse -- a synchronous interface with an async
 * implementation squeezed underneath -- is not possible, and an interface shaped to this
 * driver would let Node tests pass against orderings the tablet cannot produce.
 */
export function betterSqliteDriver(db: Database.Database): SqliteDriver {
  const driver: SqliteDriver = {
    async execute(sql, params = []) {
      db.prepare(sql).run(...(params as unknown[]));
    },
    async select<T>(sql: string, params: readonly unknown[] = []) {
      return db.prepare(sql).all(...(params as unknown[])) as T[];
    },
    async transaction<T>(fn: (tx: SqliteDriver) => Promise<T>): Promise<T> {
      // better-sqlite3's own `transaction()` helper cannot wrap an async function, so the
      // statements are issued directly. Nested transactions are not used by this engine.
      db.prepare("begin").run();
      try {
        const result = await fn(driver);
        db.prepare("commit").run();
        return result;
      } catch (error) {
        db.prepare("rollback").run();
        throw error;
      }
    },
  };
  return driver;
}
