import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { encodeEnrollment, encodeLeaseCard } from "@ceedo/shared";
import { betterSqliteDriver } from "./testing/better-sqlite-driver";
import { resolveCard } from "./card";
import type { SqliteDriver } from "./driver";

const ACTIVE = "33333333-3333-4333-8333-333333333333";
const ENDED = "44444444-4444-4444-8444-444444444444";
const ELSEWHERE = "55555555-5555-4555-8555-555555555555";

describe("resolveCard", () => {
  let driver: SqliteDriver;

  beforeEach(() => {
    const db = new Database(":memory:");
    db.exec(`
      create table stalls (id text primary key, stall_no text);
      create table leases (id text primary key, stall_id text, status text);
      insert into stalls values ('s1', 'Dry Goods-01'), ('s2', 'Wet-07');
      insert into leases values ('${ACTIVE}', 's1', 'active'), ('${ENDED}', 's2', 'terminated');
    `);
    driver = betterSqliteDriver(db);
  });

  it("resolves a card for an active lease on this tablet", async () => {
    expect(await resolveCard(driver, encodeLeaseCard(ACTIVE))).toEqual({
      kind: "lease",
      leaseId: ACTIVE,
    });
  });

  it("resolves a card whose text a scanner upper-cased", async () => {
    expect(await resolveCard(driver, encodeLeaseCard(ACTIVE).toUpperCase())).toEqual({
      kind: "lease",
      leaseId: ACTIVE,
    });
  });

  it("says the lease is not on this tablet when the pull never sent it", async () => {
    // Another market's card, or a lease created since the last sync. Not "invalid card":
    // the remedy is a sync or a search, not a reprint.
    expect(await resolveCard(driver, encodeLeaseCard(ELSEWHERE))).toEqual({
      kind: "not_on_tablet",
    });
  });

  it("refuses a lease that is no longer active, naming its stall", async () => {
    expect(await resolveCard(driver, encodeLeaseCard(ENDED))).toEqual({
      kind: "ended",
      stallNo: "Wet-07",
    });
  });

  it("refuses anything that is not a tenant card, including an enrolment code", async () => {
    expect(await resolveCard(driver, encodeEnrollment("cred", "a".repeat(64)))).toEqual({
      kind: "not_a_card",
    });
    expect(await resolveCard(driver, "4800016644290")).toEqual({ kind: "not_a_card" });
  });
});
