# Collector transaction history (design)

Date: 2026-10-02
Status: approved in conversation, awaiting written-spec review

## Goal

A collector signed in on a tablet can see every receipt the server holds under their
name -- taken on any tablet, on-the-spot fees included, and receipts the office posted for
them -- plus the receipts on this tablet that have not reached the server yet. The tablet
gets the history through its ordinary sync; the screen reads only local SQLite and works
offline.

Success: after one sync, a collector who has worked on several tablets opens Transaction
history and sees all of their receipts, newest first, each with a truthful status.

## What exists today

- `local_collections` holds every receipt this tablet authored. It is never purged.
- The mirrored `collections` table (plus allocations, cancellations, reinstatements) is
  filled by `sync_pull` (latest body: migration 20260929000055), which sends only receipts
  whose `lease_id` is in `_scope_leases`. Ambulant (on-the-spot) receipts have no lease,
  so no tablet ever receives them; neither does a receipt on a lease outside every active
  area.
- Bumping `devices.assignment_epoch` makes a tablet empty its pulled tables and pull from
  cursor 0 on its next sync, leaving device-authored tables and the outbox alone
  (migration 0056 uses this).

## Server: migration `20261002000061_pull_collector_history.sql`

`create or replace function ceedo_collections.sync_pull` with migration 0055's body,
changing only the four receipt arrays.

A receipt `c` is sent when EITHER:

1. **Lease scope (unchanged):** `exists (select 1 from _scope_leases sl where sl.id =
   c.lease_id and (c.row_version > p_cursor or sl.fresh))`, or
2. **Collector scope (new):** `c.collector_id` is an active collector with an active
   collection area, and `c.row_version > p_cursor` or one of that collector's
   `collector_assignments` rows has `row_version > p_cursor` -- the same gate the pull
   already applies to booklets and consumed serials.

Both are `exists` predicates in one `where`, so a receipt matching both is sent once.
`collection_allocations`, `collection_cancellations` and `collection_reinstatements`
follow their parent receipt with the same two predicates, their own `row_version` in place
of the receipt's.

The migration ends with a one-off
`update ceedo_collections.devices set assignment_epoch = assignment_epoch + 1 where true;`
so every tablet does one full re-pull and receives the history that a delta pull cannot
reach.

No time window: lease receipts are already sent whole, and the request is all history.
The first full pull after deploy is larger; that is the accepted cost.

## Tablet: data -- `receiptHistory` in `packages/sync-engine/src/history.ts`

```ts
receiptHistory(driver, collectorId, { before?: HistoryCursor; limit?: number })
  : Promise<{ rows: HistoryRow[]; next: HistoryCursor | null }>
```

Read-only. Union of:

- **Server rows:** `collections where collector_id = ?`. Status `synced`, or `cancelled`
  when a `collection_cancellations` row exists with no `collection_reinstatements` row
  lifting it (the rule in `ledger.ts`).
- **Device-only rows:** `local_collections where collector_id = ? and id not in
  (select id from collections)`, joined to `outbox` on id. Status `waiting` (pending /
  in_flight), `refused` (rejected, with `reason_code` / `last_result` as detail), or
  `synced` when the outbox row has been acked or purged (the server copy will arrive on
  the next pull).

Each row carries: id, or_no, booklet serial for `formatSerial`, collected_at,
business_date (server column; device rows use their `local_shifts.business_date`),
gross_amount (wire string), status, detail, and the payer: stall number + tenant name via
`leases`/`stalls`/`tenants` when `lease_id` is set, otherwise the `fee_types` name, plus
quantity from `local_lines` for device rows.

Ordered by `collected_at desc, id desc`; keyset paging on that pair, 100 per page.

## Tablet: screen -- `apps/collector/src/app/history.tsx`

- `RackHead` titled "Transaction history", subtitle the collector's name, with the
  existing `Register` freshness indicator, and Back.
- Rows grouped by business date. Each group header: the date, receipt count and total
  through `format()` / `fromWire`, cancelled receipts excluded from the total.
- Each row (`Slot`): OR number, clock time, amount, payer line, status chip --
  Waiting to sync / Synced / Refused / Cancelled by office.
- "Show older" at the foot while `next` is non-null.
- Empty state: "No receipts yet. Sync from the shift screen to load your history."
- Reloads on focus and on `onSyncSettled`.

## Entry point -- Shift screen

A `Tile` "Transaction history", hint "Your receipts", icon `history`, in both round grids
(market, and terminal/parking/slaughterhouse). When no shift is open the round is hidden,
so a one-tile `TileGrid` holding only Transaction history is shown under the "Open a
shift" card.

## Testing

- `packages/sync-engine/src/history.test.ts` (better-sqlite driver): lease and ambulant
  rows; each status (server synced, server cancelled, cancelled then reinstated, device
  pending, device rejected, device acked-and-purged); a receipt present in both tables
  appears once; another collector's receipts never appear; paging returns every row
  exactly once.
- Local Supabase: after the migration, `sync_pull(device, 0)` returns an assigned
  collector's ambulant receipt and a receipt taken on another device, with no duplicate
  ids; a delta pull with an unchanged cursor returns none of them.
- `tsc`, lint, `vitest` for sync-engine and collector; a manual check on a device.

## Rollout

1. Ask for `select max(version) from ceedo_collections.deployed_migrations;`, bundle
   `--after` it, hand over the dist-sql file.
2. Merge; OTA with `pnpm ota:production --platform android`.

Either order is safe: a new app on the old server shows only this tablet's and in-area
lease receipts until the migration runs.

## Out of scope

- Receipt line items for receipts taken on other tablets (the server does not pull them).
- Search or filters on the history screen.
- Any web-app change.
