import { PushResult } from "@ceedo/shared";
import type { SqliteDriver, Transport } from "./driver";
import { applyPull, readSyncState } from "./apply";
import { needsFullSync, resetScopedData } from "./reset";
import { applyResults, markInFlight, pushable } from "./outbox";

export interface SyncDeps {
  driver: SqliteDriver;
  transport: Transport;
  credentialId: string;
  secret: string;
  /** The device's own business date, `YYYY-MM-DD`. Drives spec E9's daily full re-sync. */
  businessDate: string;
}

export interface SyncOutcome {
  pulled: boolean;
  fullResync: boolean;
  pushed: number;
  cursor: number;
  epoch: number;
}

export class SyncError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "SyncError";
  }
}

/**
 * One sync: decide whether a full re-sync is due, pull, apply, then push the outbox.
 *
 * PULL BEFORE PUSH, DELIBERATELY. `stale_allocations` -- the one retryable rejection -- is
 * resolved by re-pulling and re-pushing, so a device that pushed first would always be
 * pushing against the world as it was one round ago, and would lose the same race twice
 * before winning it.
 */
export async function sync(deps: SyncDeps): Promise<SyncOutcome> {
  const { driver, transport, credentialId, secret, businessDate } = deps;

  let state = await readSyncState(driver);

  // The epoch is not known until a pull has answered, so a due-by-date full re-sync is
  // decided up front and a due-by-epoch one after the first pull.
  let fullResync = needsFullSync(state, null, businessDate);
  if (fullResync) {
    await resetScopedData(driver, businessDate);
    state = await readSyncState(driver);
  }

  const pullRes = await transport.post("sync-pull", {
    credential_id: credentialId,
    secret,
    cursor: state.cursor,
    epoch: state.epoch,
  });
  if (pullRes.status !== 200) {
    throw new SyncError(`sync-pull failed with ${pullRes.status}`, pullRes.status);
  }
  const envelope = pullRes.body as Record<string, unknown>;

  // D7: the device was reassigned. Its cached world is a section it must no longer show,
  // and no row_version moved, so no delta can tell it that.
  if (!fullResync && needsFullSync(state, Number(envelope.epoch), businessDate)) {
    fullResync = true;
    await resetScopedData(driver, businessDate);
    const again = await transport.post("sync-pull", {
      credential_id: credentialId,
      secret,
      cursor: 0,
      epoch: state.epoch,
    });
    if (again.status !== 200) {
      throw new SyncError(`sync-pull failed with ${again.status}`, again.status);
    }
    await applyPull(driver, again.body as Record<string, unknown>);
  } else {
    await applyPull(driver, envelope);
  }

  const rows = await pushable(driver);
  if (rows.length > 0) {
    await markInFlight(
      driver,
      rows.map((r) => r.id),
    );
    const pushRes = await transport.post("sync-push", {
      credential_id: credentialId,
      secret,
      entries: rows.map((r) => ({ type: r.type, payload: r.payload })),
    });
    if (pushRes.status !== 200) {
      // The entries stay in_flight. Spec E11: the next sync re-pushes them, because a lost
      // response is indistinguishable from a lost request and only one of those is safe to
      // assume.
      throw new SyncError(`sync-push failed with ${pushRes.status}`, pushRes.status);
    }
    await applyResults(driver, rows, PushResult.array().parse(pushRes.body));
  }

  const final = await readSyncState(driver);
  return {
    pulled: true,
    fullResync,
    pushed: rows.length,
    cursor: final.cursor,
    epoch: final.epoch,
  };
}
