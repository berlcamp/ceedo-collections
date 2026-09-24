import Database from "better-sqlite3";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = join(__dirname, "..", "drizzle");

/** The device migrations, as expo-sqlite's migrator splits and runs them. */
function run(db: Database.Database, file: string) {
  for (const statement of readFileSync(join(DIR, file), "utf8").split("--> statement-breakpoint")) {
    if (statement.trim()) db.exec(statement);
  }
}

const files = readdirSync(DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort();

describe("device migrations", () => {
  it("apply cleanly in order from an empty database", () => {
    const db = new Database(":memory:");
    for (const f of files) run(db, f);
  });

  it("leave a fresh install with the sync_state row its first sync reads", () => {
    // Found on the first production install: only a dev probe screen ever created this row,
    // so enrolment failed with "sync_state row 1 is missing".
    const db = new Database(":memory:");
    for (const f of files) run(db, f);
    expect(db.prepare("select id, cursor, epoch from sync_state").all()).toEqual([
      { id: 1, cursor: 0, epoch: 0 },
    ]);
  });

  it("does not disturb an existing tablet's sync position", () => {
    const db = new Database(":memory:");
    for (const f of files.filter((f) => f < "0003")) run(db, f);
    db.exec("insert or replace into sync_state (id, cursor, epoch) values (1, 812, 2)");
    run(db, files.find((f) => f.startsWith("0003"))!);
    expect(db.prepare("select cursor, epoch from sync_state where id = 1").get()).toEqual({
      cursor: 812,
      epoch: 2,
    });
  });

  it("0002 adds fee_types.facility_type and forces one full re-pull", () => {
    // A tablet that pulled fee types before it had this column had the value dropped by
    // applyPull, and its cursor is already past those rows. Resetting it re-fetches them.
    const db = new Database(":memory:");
    for (const f of files.filter((f) => f < "0002")) run(db, f);
    db.exec("insert or replace into sync_state (id, cursor, epoch) values (1, 500, 3)");

    run(db, files.find((f) => f.startsWith("0002"))!);

    const columns = db.prepare("select name from pragma_table_info('fee_types')").all();
    expect(columns).toContainEqual({ name: "facility_type" });
    expect(db.prepare("select cursor, epoch from sync_state where id = 1").get()).toEqual({
      cursor: 0,
      epoch: 3,
    });
  });
});
