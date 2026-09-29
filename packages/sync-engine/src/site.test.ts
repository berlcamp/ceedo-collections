import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { betterSqliteDriver } from "./testing/better-sqlite-driver";
import { collectorSite, feeChoices, payerPrompt } from "./site";
import type { SqliteDriver } from "./driver";

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
      insert into facilities values ('f1', 'IBJT', 'terminal', 1, 5), ('f2', 'CPM', 'market', 1, 6);
      create table fee_types (id text primary key, name text, accrues integer, active integer,
                              facility_type text);
      create table rates (id text primary key, fee_type_id text, rate_class text);
      insert into fee_types values
        ('mkt',  'Market stall rental (daily)', 1, 1, 'market'),
        ('amb',  'Ambulant vendor fee',          0, 1, 'market'),
        ('term', 'Terminal fee',                 0, 1, 'terminal'),
        ('slh',  'Slaughter fee',                0, 1, 'slaughterhouse'),
        ('misc', 'Unclassified fee',             0, 1, null),
        ('old',  'Retired terminal fee',         0, 0, 'terminal');
      insert into rates values
        ('r1', 'mkt', ''), ('r2', 'amb', ''), ('r3', 'term', 'bus'), ('r4', 'term', 'jeepney'),
        ('r5', 'slh', 'hog'), ('r6', 'misc', ''), ('r7', 'old', 'bus');
    `);
    driver = betterSqliteDriver(db);
  });

  it("has no site for a collector with no collection area", async () => {
    expect(await collectorSite(driver, "c1")).toBeNull();
  });

  it("reads the site from the collector's collection area, not the tablet", async () => {
    db.exec(`insert into collector_assignments values ('a1', 'c1', 'f1', null, 1),
                                                      ('a2', 'c1', 'f2', null, 0)`);
    expect(await collectorSite(driver, "c1")).toEqual({ name: "IBJT", type: "terminal" });
  });

  it("reads one site for several sections of the same facility", async () => {
    db.exec(`insert into collector_assignments values ('a1', 'c1', 'f2', 's1', 1),
                                                      ('a2', 'c1', 'f2', 's2', 1)`);
    expect(await collectorSite(driver, "c1")).toEqual({ name: "CPM", type: "market" });
  });

  it("has no single site for a collector whose areas span two facilities", async () => {
    db.exec(`insert into collector_assignments values ('a1', 'c1', 'f1', null, 1),
                                                      ('a2', 'c1', 'f2', null, 1)`);
    expect(await collectorSite(driver, "c1")).toBeNull();
  });

  it("offers the terminal tablet its vehicle classes, not the slaughterhouse's animals", async () => {
    const names = (await feeChoices(driver, "terminal")).map(
      (c) => `${c.fee_name}${c.rate_class ? `/${c.rate_class}` : ""}`,
    );
    expect(names).toEqual(["Terminal fee/bus", "Terminal fee/jeepney", "Unclassified fee"]);
  });

  it("never offers an accruing or inactive fee", async () => {
    const ids = (await feeChoices(driver, "market")).map((c) => c.fee_type_id);
    expect(ids).toEqual(["amb", "misc"]);
  });

  it("offers every active on-the-spot fee when the site is not yet known", async () => {
    const ids = new Set((await feeChoices(driver, null)).map((c) => c.fee_type_id));
    expect(ids).toEqual(new Set(["amb", "term", "slh", "misc"]));
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
