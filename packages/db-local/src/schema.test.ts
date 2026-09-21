import { describe, expect, it } from "vitest";
import { PULLED_TABLES, DEVICE_AUTHORED_TABLES } from "./schema";

describe("the device schema's two halves", () => {
  /**
   * SPEC E8 LIVES OR DIES ON THIS SPLIT. An epoch reset wipes pulled data and pulls from
   * cursor 0. It must NEVER touch device-authored state -- the outbox is a collector's
   * record of cash already taken, and discarding it on a reassignment is precisely the
   * failure spec §6.3 exists to prevent.
   *
   * Encoding the split as two lists, with a test that they cannot overlap, means a table
   * added later has to be classified deliberately rather than defaulting into the wipe.
   */
  it("never lists a table as both pulled and device-authored", () => {
    const overlap = PULLED_TABLES.filter((t) =>
      (DEVICE_AUTHORED_TABLES as readonly string[]).includes(t),
    );
    expect(overlap).toEqual([]);
  });

  it("holds the outbox, local shifts, PIN attempts and sync state as device-authored", () => {
    expect([...DEVICE_AUTHORED_TABLES].sort()).toEqual(
      ["outbox", "local_shifts", "pin_attempts", "sync_state"].sort(),
    );
  });

  it("mirrors all 17 arrays sync_pull returns", () => {
    // Verified against sync_pull's jsonb_build_object key list, migration
    // 20260918000037_sync_pull_truncate.sql. `devices` is deliberately NOT among them:
    // the authenticate heartbeat bumps devices.row_version on every call, and the device
    // never receives its own row, so that churn costs cursor motion and no payload.
    expect([...PULLED_TABLES].sort()).toEqual(
      [
        "facilities", "sections", "stalls", "tenants", "leases",
        "fee_types", "rates", "collectors", "booklets", "booklet_assignments",
        "consumed_serials", "spoiled_forms", "charges", "collections",
        "collection_allocations", "collection_cancellations", "charge_condonations",
      ].sort(),
    );
  });
});
