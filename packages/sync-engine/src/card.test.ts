import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { encodeEnrollment, encodeLeaseCard } from "@ceedo/shared";
import { betterSqliteDriver } from "./testing/better-sqlite-driver";
import { resolveCard } from "./card";
import type { SqliteDriver } from "./driver";

const ACTIVE = "33333333-3333-4333-8333-333333333333";
const ENDED = "44444444-4444-4444-8444-444444444444";
const ELSEWHERE = "55555555-5555-4555-8555-555555555555";
const OTHER_SITE = "66666666-6666-4666-8666-666666666666";
const ME = "collector-1";

describe("resolveCard", () => {
  let driver: SqliteDriver;

  beforeEach(() => {
    const db = new Database(":memory:");
    db.exec(`
      create table sections (id text primary key, facility_id text);
      create table stalls (id text primary key, stall_no text, section_id text);
      create table leases (id text primary key, stall_id text, status text);
      create table collector_assignments (id text primary key, collector_id text,
                                          facility_id text, section_id text, active integer);
      insert into sections values ('dry', 'cpm'), ('wet', 'cpm'), ('bays', 'ibjt');
      insert into stalls values ('s1', 'Dry Goods-01', 'dry'), ('s2', 'Wet-07', 'wet'),
                                ('s3', 'Bay-02', 'bays');
      insert into leases values ('${ACTIVE}', 's1', 'active'), ('${ENDED}', 's2', 'terminated'),
                                ('${OTHER_SITE}', 's3', 'active');
      insert into collector_assignments values ('a1', '${ME}', 'cpm', null, 1),
                                               ('a2', '${ME}', 'ibjt', 'bays', 0);
    `);
    driver = betterSqliteDriver(db);
  });

  it("resolves a card for an active lease on this tablet", async () => {
    expect(await resolveCard(driver, encodeLeaseCard(ACTIVE), ME)).toEqual({
      kind: "lease",
      leaseId: ACTIVE,
    });
  });

  it("resolves a card whose text a scanner upper-cased", async () => {
    expect(await resolveCard(driver, encodeLeaseCard(ACTIVE).toUpperCase(), ME)).toEqual({
      kind: "lease",
      leaseId: ACTIVE,
    });
  });

  it("refuses a card from outside the collector's collection area", async () => {
    // a2 would cover it, but a withdrawn area covers nothing.
    expect(await resolveCard(driver, encodeLeaseCard(OTHER_SITE), ME)).toEqual({
      kind: "outside_area",
      stallNo: "Bay-02",
    });
  });

  it("says the lease is not on this tablet when the pull never sent it", async () => {
    // Another market's card, or a lease created since the last sync. Not "invalid card":
    // the remedy is a sync or a search, not a reprint.
    expect(await resolveCard(driver, encodeLeaseCard(ELSEWHERE), ME)).toEqual({
      kind: "not_on_tablet",
    });
  });

  it("refuses a lease that is no longer active, naming its stall", async () => {
    expect(await resolveCard(driver, encodeLeaseCard(ENDED), ME)).toEqual({
      kind: "ended",
      stallNo: "Wet-07",
    });
  });

  it("refuses anything that is not a tenant card, including an enrolment code", async () => {
    expect(await resolveCard(driver, encodeEnrollment("cred", "a".repeat(64)), ME)).toEqual({
      kind: "not_a_card",
    });
    expect(await resolveCard(driver, "4800016644290", ME)).toEqual({ kind: "not_a_card" });
  });
});
