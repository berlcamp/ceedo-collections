/**
 * Whether a Postgres/PostgREST error means "this relation does not exist here", not a real
 * failure. The DB bundle and the web app are deployed separately (see
 * scripts/bundle-migrations.mjs's own comment): if the web app that reads
 * `collection_recoveries` reaches production before the migration bundle that creates it is
 * run, every officeEncoded lookup would otherwise throw and take Receipts, Shifts, the
 * subsidiary ledger, RCD and the monthly reports down with it, for a table that is simply
 * not there yet. PostgREST reports a relation it cannot find in its schema cache as
 * PGRST205; a query that somehow reaches Postgres directly (e.g. through `rpc`) reports the
 * same fact as 42P01, Postgres's own "undefined_table". Both are read as "no recovered
 * receipts exist" -- an empty set, not an error -- and every other code still throws.
 */
export function isMissingRelationError(error: { code?: string | null } | null | undefined): boolean {
  return error?.code === "PGRST205" || error?.code === "42P01";
}
