import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client, type Client as PgClient } from "pg";
import { authenticatorClient } from "../helpers/authenticator";
import { POSTGRES_URL } from "../helpers/supabase";

/**
 * The Phase 3a handover names THREE things that exempt the `postgres` test connection from
 * what a real caller faces: object ownership, rolbypassrls, and the pg_safeupdate guard.
 * There are FIVE. `authenticator` also carries statement_timeout=8s and lock_timeout=8s.
 *
 * This file pins all five, so that a future change to the Supabase image that drops one is
 * a red test rather than a silent widening of what tests are blind to.
 */
describe("the exemptions a postgres test connection enjoys", () => {
  let app: PgClient;
  let su: PgClient;

  beforeAll(async () => {
    app = await authenticatorClient();
    su = new Client({ connectionString: POSTGRES_URL });
    await su.connect();
  });

  afterAll(async () => {
    await app.end();
    await su.end();
  });

  it("connects as authenticator and runs as ceedo_app", async () => {
    const { rows } = await app.query(
      "select session_user as session, current_user as current",
    );
    expect(rows[0].session).toBe("authenticator");
    expect(rows[0].current).toBe("ceedo_app");
  });

  it("applies an 8s statement_timeout that the postgres connection does not", async () => {
    const mine = await app.query("show statement_timeout");
    expect(mine.rows[0].statement_timeout).toBe("8s");

    const theirs = await su.query("show statement_timeout");
    expect(theirs.rows[0].statement_timeout).toBe("0");
  });

  it("applies an 8s lock_timeout that the postgres connection does not", async () => {
    const mine = await app.query("show lock_timeout");
    expect(mine.rows[0].lock_timeout).toBe("8s");

    const theirs = await su.query("show lock_timeout");
    expect(theirs.rows[0].lock_timeout).toBe("0");
  });

  it("cancels a 9 second query that the postgres connection completes", async () => {
    await expect(app.query("select pg_sleep(9)")).rejects.toThrow(/statement timeout/i);
    await expect(su.query("select pg_sleep(9)")).resolves.toBeDefined();
  }, 30_000);

  it("loads pg_safeupdate, which the postgres connection never loads", async () => {
    // A table ceedo_app owns, so the refusal below is the guard and not a privilege error.
    await app.query("create temp table guard_probe (id int)");
    await app.query("insert into guard_probe values (1)");
    await expect(app.query("delete from guard_probe")).rejects.toThrow(
      /requires a WHERE clause/i,
    );
  });

  it("does NOT bypass RLS the way the postgres connection does", async () => {
    const mine = await app.query(
      "select rolbypassrls from pg_roles where rolname = current_user",
    );
    expect(mine.rows[0].rolbypassrls).toBe(false);

    const theirs = await su.query(
      "select rolbypassrls from pg_roles where rolname = 'postgres'",
    );
    expect(theirs.rows[0].rolbypassrls).toBe(true);
  });
});
