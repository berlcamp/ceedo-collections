/**
 * THE INTERFACE IS ASYNC-SHAPED BECAUSE THE CONSTRAINED DRIVER IS, NOT BECAUSE NODE IS.
 *
 * Phase 3a found two production-blocking bugs that a 641-test green suite could not see,
 * because the test connection was exempt from things the real caller was not. A driver
 * interface is the same opportunity one level down: `better-sqlite3` is synchronous and
 * `expo-sqlite` is not, and an interface shaped to the convenient driver would let Node
 * tests pass against orderings the tablet cannot produce.
 *
 * So the interface is shaped to `expo-sqlite`. The Node driver wraps its synchronous calls
 * in already-resolved promises, which is strictly the easy direction.
 *
 * This is not sufficient on its own. Spec E1 also requires one on-device test that runs
 * this same engine against `expo-sqlite` -- the local translation of "connect as
 * authenticator, not set role ceedo_app". That test is Task 10.
 */
export interface SqliteDriver {
  execute(sql: string, params?: readonly unknown[]): Promise<void>;
  select<T>(sql: string, params?: readonly unknown[]): Promise<T[]>;
  /**
   * Runs `fn` inside one transaction, passing a driver bound to it. Commits on resolve,
   * rolls back on throw.
   */
  transaction<T>(fn: (tx: SqliteDriver) => Promise<T>): Promise<T>;
}

export interface Transport {
  post(
    fn: "sync-pull" | "sync-push" | "closeout",
    body: unknown,
  ): Promise<{ status: number; body: unknown }>;
}
