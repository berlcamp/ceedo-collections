import {
  PushResult,
  fromCentavos,
  fromPesos,
  parsePesoInput,
  shiftVariance,
  toDecimalString,
  type Centavos,
} from "@ceedo/shared";
import type { SqliteDriver, Transport } from "./driver";
import { applyResults, enqueue, markInFlight, pushable } from "./outbox";

export interface ShiftDeps {
  transport: Transport;
  credentialId: string;
  secret: string;
  businessDate: string;
}

export interface DeviceTotals {
  count: number;
  /** The wire form: a plain 2dp decimal string. Never a float. */
  total: string;
}

export type CloseOutcome =
  | {
      status: "closed";
      declaredTotal: string;
      systemCount: number;
      systemTotal: string;
      /** Signed. Over and short are different problems (parent §6.5 step 5). */
      variance: string;
    }
  | {
      status: "mismatch";
      deviceCount: number;
      deviceTotal: string;
      systemCount: number;
      systemTotal: string;
    }
  | {
      status: "closed_unsynced";
      declaredTotal: string;
      deviceCount: number;
      deviceTotal: string;
      detail: string;
    };

/**
 * The outbox id of a shift's close entry.
 *
 * DERIVED, NOT RANDOM, so a second attempt at the same closeout reuses the row rather than
 * queueing a second one. `enqueue` is `on conflict do nothing`, so a collector who taps
 * Close out twice after a failed push gets one entry, not two.
 *
 * The shift_open entry uses the shift's own id, because THAT id is what the server keys its
 * idempotency on. close_shift keys on the shift's status instead, so this one only has to
 * be locally unique and stable.
 */
function closeEntryId(shiftId: string): string {
  return `${shiftId}#close`;
}

/**
 * Opens a shift locally and queues its `shift_open`, under ONE id.
 *
 * One id because the server's idempotency is on the client-generated shift id: a re-pushed
 * shift_open answers `duplicate` against the shift this row already named, rather than
 * opening a second one.
 *
 * `id` IS REQUIRED, and it used to default to `crypto.randomUUID()`. That default was a
 * trap of exactly the kind this phase exists to catch: `crypto` is a Node global, and
 * neither Hermes, React Native nor Expo's winter runtime provides one. It worked in every
 * test and would have thrown on the tablet the moment a collector tapped "Open a shift".
 *
 * The engine cannot import React Native (parent spec §4), so it cannot reach for
 * `expo-crypto` itself. Making the caller supply the id removes the environment-dependent
 * branch instead of hiding it: there is no longer a default that can be right in one
 * runtime and absent in the other.
 */
export async function openShift(
  driver: SqliteDriver,
  input: { id: string; collectorId: string; businessDate: string; openedAt?: string },
): Promise<string> {
  const { id } = input;
  const openedAt = input.openedAt ?? new Date().toISOString();

  await driver.execute(
    `insert into local_shifts (id, collector_id, business_date, opened_at, status)
     values (?, ?, ?, ?, 'open')`,
    [id, input.collectorId, input.businessDate, openedAt],
  );

  await enqueue(driver, {
    id,
    type: "shift_open",
    payload: {
      id,
      collector_id: input.collectorId,
      business_date: input.businessDate,
      opened_at: openedAt,
    },
    collectorId: input.collectorId,
  });

  return id;
}

/**
 * What THIS DEVICE believes it collected during THIS shift.
 *
 * `where shift_id = ?`, and the predicate is the whole point: migration 20260919000043 put
 * shift_id on collections precisely so a closeout counts one shift rather than a
 * collector's whole day. A sum without it would ask a collector to match money that was
 * never in their drawer.
 *
 * Summed as INTEGER CENTAVOS through packages/shared/src/money.ts, never as SQL `sum()`
 * over a text column or a JS float over pesos. This is the figure a collector's cash is
 * checked against; a rounding artefact in it is a collector accused of being a centavo
 * short.
 */
export async function deviceTotals(
  driver: SqliteDriver,
  shiftId: string,
): Promise<DeviceTotals> {
  const rows = await driver.select<{ gross_amount: string | null }>(
    "select gross_amount from collections where shift_id = ?",
    [shiftId],
  );
  const total = rows.reduce<Centavos>(
    (acc, row) => fromCentavos(acc + parsePesoInput(row.gross_amount ?? "0")),
    fromCentavos(0),
  );
  return { count: rows.length, total: toDecimalString(total) };
}

/**
 * Closes a shift: queue, push, then record whichever of the three answers came back.
 *
 * THE QUEUE COMES BEFORE THE NETWORK, and that ordering is the guarantee. The one situation
 * `closed_unsynced` exists for is no signal; if the entry were queued only after a
 * successful push, that would be the one situation in which nothing was queued at all.
 *
 * NO EXCEPTION ESCAPES. A transport throw or a non-200 becomes `closed_unsynced`, because
 * the collector standing there needs to leave and the next one needs to sign in -- parent
 * §3, "blocking a collector over bad signal is unworkable". An error the UI has to
 * interpret is a decision made in the wrong place.
 */
export async function closeShift(
  driver: SqliteDriver,
  deps: ShiftDeps,
  input: { shiftId: string; declaredTotal: string },
): Promise<CloseOutcome> {
  const shifts = await driver.select<{ collector_id: string }>(
    "select collector_id from local_shifts where id = ?",
    [input.shiftId],
  );
  const collectorId = shifts[0]?.collector_id;
  if (!collectorId) throw new Error(`No such local shift: ${input.shiftId}`);

  const totals = await deviceTotals(driver, input.shiftId);
  const entryId = closeEntryId(input.shiftId);

  await enqueue(driver, {
    id: entryId,
    type: "shift_close",
    payload: {
      id: input.shiftId,
      declared_total: input.declaredTotal,
      device_count: totals.count,
      device_total: totals.total,
    },
    collectorId,
  });

  const offline = async (detail: string): Promise<CloseOutcome> => {
    // Closed HERE, pending THERE. The shift stops blocking the next sign-in (spec E10 tests
    // for `open` specifically) while its entry stays pushable in the outbox.
    await driver.execute(
      `update local_shifts
          set status = 'closed_unsynced', closed_at = ?, declared_total = ?,
              device_count = ?, device_total = ?
        where id = ?`,
      [new Date().toISOString(), input.declaredTotal, totals.count, totals.total, input.shiftId],
    );
    return {
      status: "closed_unsynced",
      declaredTotal: input.declaredTotal,
      deviceCount: totals.count,
      deviceTotal: totals.total,
      detail,
    };
  };

  const rows = (await pushable(driver)).filter((row) => row.id === entryId);
  if (rows.length === 0) {
    // Already acked by an earlier attempt: the server has this closeout and the local row
    // simply has not caught up.
    return offline("This closeout was already sent.");
  }

  let results: PushResult[];
  try {
    await markInFlight(driver, [entryId]);
    const res = await deps.transport.post("sync-push", {
      credential_id: deps.credentialId,
      secret: deps.secret,
      entries: rows.map((row) => ({ type: row.type, payload: row.payload })),
    });
    if (res.status !== 200) return offline(`The server answered ${res.status}.`);
    results = PushResult.array().parse(res.body);
  } catch (error) {
    // The entry stays `in_flight`, which spec E11 makes pushable: a lost response is
    // indistinguishable from a lost request, and only one of those is safe to assume.
    return offline(String(error));
  }

  await applyResults(driver, rows, results);
  const result = results[0];
  if (!result) return offline("The server returned no result for this closeout.");

  if (result.status === "mismatch") {
    // RECORDS are missing, which is the comparison that BLOCKS. The shift stays open and a
    // supervisor reconciles; nothing local is rewritten.
    return {
      status: "mismatch",
      deviceCount: result.device_count ?? totals.count,
      deviceTotal: totals.total,
      systemCount: result.system_count ?? 0,
      systemTotal: toWire(result.system_total),
      };
  }

  if (result.status === "closed" || result.status === "already_closed") {
    const declared = parsePesoInput(input.declaredTotal);
    const system = fromPesos(Number(result.system_total ?? 0));
    // Computed locally from two exact figures rather than read off the wire: the server's
    // `variance` arrives as a JSON number, and this one is the figure shown to the person
    // whose drawer it describes.
    const variance = shiftVariance({ declared, system });

    await driver.execute(
      `update local_shifts
          set status = 'closed', closed_at = ?, declared_total = ?,
              device_count = ?, device_total = ?
        where id = ?`,
      [new Date().toISOString(), input.declaredTotal, totals.count, totals.total, input.shiftId],
    );

    return {
      status: "closed",
      declaredTotal: input.declaredTotal,
      systemCount: result.system_count ?? totals.count,
      systemTotal: toDecimalString(system),
      variance: toDecimalString(variance),
    };
  }

  // `rejected`, or anything else this device does not know how to read. The entry has
  // already been settled by applyResults; locally the shift closes unsynced so the collector
  // is not held at the screen, and the outbox carries the reason.
  return offline(`The server answered ${result.status}${result.reason ? ` (${result.reason})` : ""}.`);
}

/** Inbound money is a JSON number (see sync-contract.ts's `wireMoney`). */
function toWire(value: number | string | undefined): string {
  if (value === undefined) return "0.00";
  return toDecimalString(
    typeof value === "number" ? fromPesos(value) : parsePesoInput(value),
  );
}
