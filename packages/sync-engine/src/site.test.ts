import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { betterSqliteDriver } from "./testing/better-sqlite-driver";
import { collectorSites, feeChoices, payerPrompt } from "./site";
import type { SqliteDriver } from "./driver";
import type { CollectorSite } from "./site";

const IBJT: CollectorSite = { id: "f1", name: "IBJT", type: "terminal" };
const CPM: CollectorSite = { id: "f2", name: "CPM", type: "market" };
const GYM: CollectorSite = { id: "f3", name: "City Gym", type: "other" };

describe("the collector's site and its fees", () => {
  let db: Database.Database;
  let driver: SqliteDriver;

  beforeEach(() => {
    db = new Database(":memory:");
    db.exec(`
      create table facilities (id text primary key, name text, type text, active integer,
                               row_version integer);
      create table collector_assignments (id text primary key, collector_id text,
                                          facility_id text, section_id text, active integer);
      insert into facilities values ('f1', 'IBJT', 'terminal', 1, 5), ('f2', 'CPM', 'market', 1, 6),
                                    ('f3', 'City Gym', 'other', 1, 7);
      create table fee_types (id text primary key, code text, name text, accrues integer,
                              active integer, facility_type text, amount_mode text,
                              facility_id text);
      create table rates (id text primary key, fee_type_id text, rate_class text);
      -- The first six were pulled before local migration 0007: amount_mode and facility_id null.
      insert into fee_types values
        ('mkt',  null, 'Market stall rental (daily)', 1, 1, 'market', null, null),
        ('amb',  null, 'Ambulant vendor fee',          0, 1, 'market', null, null),
        ('term', null, 'Terminal fee',                 0, 1, 'terminal', null, null),
        ('slh',  null, 'Slaughter fee',                0, 1, 'slaughterhouse', null, null),
        ('misc', null, 'Unclassified fee',             0, 1, null, null, null),
        ('old',  null, 'Retired terminal fee',         0, 0, 'terminal', null, null),
        ('elec-cpm',  'ELEC_CPM',  'Electricity bill payment (Public Mall)', 0, 1, null, 'keyed', 'f2'),
        ('elec-ibjt', 'ELEC_IBJT', 'Electricity bill payment (IBJT)',        0, 1, null, 'keyed', 'f1'),
        ('cr-cpm',    'CPM_CR',    'Public Mall CR (cash ticket)',           0, 1, null, 'keyed', 'f2'),
        ('occ',       'OCCUPANCY', 'Occupancy fee',                          0, 1, 'market', 'keyed', null),
        ('cit',       'CITATION',  'Citation ticket',                        0, 1, 'other', 'keyed', null);
      insert into rates values
        ('r1', 'mkt', ''), ('r2', 'amb', ''), ('r3', 'term', 'bus'), ('r4', 'term', 'jeepney'),
        ('r5', 'slh', 'hog'), ('r6', 'misc', ''), ('r7', 'old', 'bus');
    `);
    driver = betterSqliteDriver(db);
  });

  it("has no sites for a collector with no collection area", async () => {
    expect(await collectorSites(driver, "c1")).toEqual([]);
  });

  it("reads the sites from the collector's active collection areas, not the tablet", async () => {
    db.exec(`insert into collector_assignments values ('a1', 'c1', 'f1', null, 1),
                                                      ('a2', 'c1', 'f2', null, 0)`);
    expect(await collectorSites(driver, "c1")).toEqual([IBJT]);
  });

  it("reads one site for several sections of the same facility", async () => {
    db.exec(`insert into collector_assignments values ('a1', 'c1', 'f2', 's1', 1),
                                                      ('a2', 'c1', 'f2', 's2', 1)`);
    expect(await collectorSites(driver, "c1")).toEqual([CPM]);
  });

  it("reads every site of a collector assigned to several facilities", async () => {
    db.exec(`insert into collector_assignments values ('a1', 'c1', 'f1', null, 1),
                                                      ('a2', 'c1', 'f2', null, 1)`);
    expect(await collectorSites(driver, "c1")).toEqual([CPM, IBJT]);
  });

  it("offers a terminal collector its vehicle classes, not the slaughterhouse's animals", async () => {
    const names = (await feeChoices(driver, [IBJT]))
      .filter((c) => c.amount_mode === "rate")
      .map((c) => `${c.fee_name}${c.rate_class ? `/${c.rate_class}` : ""}`);
    expect(names).toEqual(["Terminal fee/bus", "Terminal fee/jeepney"]);
  });

  it("offers the fees of every kind of facility the collector is assigned to", async () => {
    const ids = (await feeChoices(driver, [CPM, IBJT])).map((c) => c.fee_type_id);
    expect(new Set(ids)).toEqual(new Set(["amb", "term", "elec-cpm", "elec-ibjt"]));
  });

  it("never offers an accruing, inactive or unclassified fee", async () => {
    const ids = (await feeChoices(driver, [CPM])).map((c) => c.fee_type_id);
    expect(ids).toEqual(["amb", "elec-cpm"]);
  });

  it("offers nothing to a collector with no facility", async () => {
    expect(await feeChoices(driver, [])).toEqual([]);
  });

  it("offers a facility's own fees only at that facility", async () => {
    const ids = (await feeChoices(driver, [CPM])).map((c) => c.fee_type_id);
    expect(ids).toContain("elec-cpm");
    expect(ids).not.toContain("elec-ibjt");
  });

  it("offers each assigned facility's own fees to a collector at two facilities", async () => {
    const ids = (await feeChoices(driver, [IBJT, CPM])).map((c) => c.fee_type_id);
    expect(ids).toEqual(expect.arrayContaining(["elec-cpm", "elec-ibjt", "term", "amb"]));
  });

  it("offers a keyed fee once, with no rate class, though it has no rates", async () => {
    const elec = (await feeChoices(driver, [CPM])).filter((c) => c.fee_type_id === "elec-cpm");
    expect(elec).toEqual([
      { fee_type_id: "elec-cpm", fee_name: "Electricity bill payment (Public Mall)", rate_class: null, amount_mode: "keyed" },
    ]);
  });

  it("never offers the occupancy fee or a cash-ticket fee", async () => {
    const ids = (await feeChoices(driver, [CPM])).map((c) => c.fee_type_id);
    expect(ids).not.toContain("occ");
    expect(ids).not.toContain("cr-cpm");
  });

  it("offers a facility-less fee by facility type, Citation at an 'other' facility", async () => {
    expect((await feeChoices(driver, [GYM])).map((c) => c.fee_type_id)).toEqual(["cit"]);
    expect((await feeChoices(driver, [CPM])).map((c) => c.fee_type_id)).not.toContain("cit");
  });

  it("reads a fee pulled before 0007 (null amount_mode, null facility_id) as a facility-less rate fee", async () => {
    const amb = (await feeChoices(driver, [CPM])).find((c) => c.fee_type_id === "amb");
    expect(amb).toEqual({ fee_type_id: "amb", fee_name: "Ambulant vendor fee", rate_class: "", amount_mode: "rate" });
  });
});

describe("payerPrompt", () => {
  it("asks for a plate at the terminal and parking, an owner at the slaughterhouse", () => {
    expect(payerPrompt("terminal")).toBe("Plate number");
    expect(payerPrompt("parking")).toBe("Plate number");
    expect(payerPrompt("slaughterhouse")).toBe("Owner's name");
    expect(payerPrompt("market")).toBe("Vendor's name");
    expect(payerPrompt(null)).toBe("Vendor's name");
  });
});
