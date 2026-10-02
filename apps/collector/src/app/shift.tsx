import { useCallback, useEffect, useState } from "react";
import { useFocusEffect, useRouter } from "expo-router";
import { randomUUID } from "expo-crypto";
import {
  closeoutReadiness,
  collectorSites,
  deviceTotals,
  openShift,
  purgeAcked,
  type CloseoutReadiness,
  type CollectorSite,
} from "@ceedo/sync-engine";
import {
  Action,
  Body,
  Card,
  Figure,
  Group,
  Hero,
  Icon,
  Label,
  Note,
  Punch,
  RackHead,
  Register,
  Rift,
  Screen,
  Statement,
  Tile,
  TileGrid,
  color,
} from "../ui";
import { syncFailure } from "../ui/failures";
import { fromWire } from "../ui/money";
import { clockTime } from "../ui/time";
import { freshness, type Freshness } from "../ui/staleness";
import { deviceDriver } from "../db/driver";
import { signedIn, signOut } from "../auth/session";
import { businessDate, onSyncSettled, syncNow } from "../sync/device-sync";
import { SyncHealthNotice } from "../sync/SyncHealthNotice";

interface LocalShift {
  id: string;
  collector_id: string;
  business_date: string;
  opened_at: string;
  status: string;
}

/**
 * The shift a collector works in: open, collect, sync, close out.
 *
 * MONEY HERE GOES THROUGH `format()` LIKE EVERYWHERE ELSE. `deviceTotals` returns the wire
 * form -- a plain decimal string with no peso sign and no separators -- and this screen
 * used to render it as `₱{totals.total}`. That is interpolation, which the money rule
 * forbids, and the visible cost was real: the shift total printed `₱1250.00` where the
 * lease screen printed `₱1,250.00`, in the one place in the app whose whole purpose is
 * for two figures to be compared. `fromWire` routes it back through `format()`.
 */
export default function Shift() {
  const router = useRouter();
  const driver = deviceDriver();
  const collector = signedIn();

  const [shift, setShift] = useState<LocalShift | null>(null);
  const [totals, setTotals] = useState({ count: 0, total: "0.00" });
  const [readiness, setReadiness] = useState<CloseoutReadiness>({ block: null, refused: null });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [fresh, setFresh] = useState<Freshness | null>(null);
  const [sites, setSites] = useState<CollectorSite[]>([]);

  const load = useCallback(async () => {
    if (!collector) return;
    const rows = await driver.select<LocalShift>(
      `select id, collector_id, business_date, opened_at, status
         from local_shifts
        where collector_id = ? and status = 'open'
        order by opened_at desc`,
      [collector.id],
    );
    const mine = rows[0] ?? null;
    setShift(mine);
    setTotals(mine ? await deviceTotals(driver, mine.id) : { count: 0, total: "0.00" });
    setReadiness(
      mine ? await closeoutReadiness(driver, mine.id) : { block: null, refused: null },
    );
    setFresh(await freshness(driver, businessDate()));
    setSites(await collectorSites(driver, collector.id));
  }, [collector, driver]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  // An automatic sync can clear the closeout block or age the freshness bar while this
  // screen is up, and a Close out button still saying "3 entries" after they went is wrong.
  useEffect(() => onSyncSettled(() => void load()), [load]);

  if (!collector) {
    return (
      <Screen
        head={<RackHead title="Shift" icon="briefcase-outline" />}
        shelf={<Punch label="Go to sign-in" icon="login" onPress={() => router.replace("/sign-in")} />}
      >
        <Note>Not signed in.</Note>
      </Screen>
    );
  }

  // §6.5 step 1: "force sync; outbox must reach zero pending". Enforced here rather than
  // assumed, because a closeout pushed while receipts are still queued compares the
  // device's figures against a server that has not seen them yet -- and answers `mismatch`
  // for a shift that is in fact perfectly balanced. The shift's OWN refused close is not
  // counted (see closeoutReadiness): closing out again is how it is re-sent.
  const { block, refused } = readiness;
  const stillQueued = block !== null;
  const blockedBy =
    block?.kind === "earlier_close"
      ? "An earlier closeout on this tablet has not been accepted by the server."
      : block
        ? `${block.count} entr${block.count === 1 ? "y has" : "ies have"} not reached the server yet.`
        : null;

  const sync = async () => {
    setBusy(true);
    setMessage(null);
    setDetail(null);
    setFailed(false);
    try {
      const outcome = await syncNow();
      setMessage(
        `Synced${outcome.fullResync ? " (full re-sync)" : ""}. ` +
          `${outcome.pushed} entr${outcome.pushed === 1 ? "y" : "ies"} pushed.`,
      );
      // §6.4's retention rule had no caller until now; the outbox simply grew.
      // Rejected entries are NOT purged -- they are kept until resolved, because a
      // rejection never means discard (§6.3). Housekeeping runs only after a sync
      // that already succeeded, and its own failure is swallowed rather than
      // reported: a purge that failed to run this time will get another chance on
      // the next sync, but a sync that failed because housekeeping threw would cost
      // the collector the very thing this screen exists to guarantee.
      try {
        await purgeAcked(driver, 30);
      } catch {
        // Deliberately silent -- see comment above.
      }
    } catch (error) {
      // Never fatal. A collector with no signal keeps working offline; that is the
      // whole design (parent §3).
      const said = syncFailure(error);
      setMessage(said.said);
      setDetail(said.detail);
      setFailed(true);
    } finally {
      setBusy(false);
      await load();
    }
  };

  return (
    <Screen
      head={
        <RackHead
          title={collector.full_name ?? collector.id}
          subtitle={`Business date ${businessDate()}`}
          icon="account-circle-outline"
          register={
            fresh ? <Register state={fresh.state} detail={fresh.short} /> : undefined
          }
        />
      }
      shelf={
        shift ? (
          <>
          {/* THE REMEDY SITS WITH THE REASON. "Sync now" was in the body, and at 360dp
              the warning above it pushed the control that resolves the block clean off
              the bottom of the scroll -- a stated reason with its fix out of sight. */}
          {stillQueued ? (
            <Action label="Sync now" icon="sync" busy={busy} busyLabel="Syncing" onPress={() => void sync()} />
          ) : null}
          <Punch
            label="Close out"
            icon="cash-register"
            // Short, and NOT a repeat of the statement in the body. The body explains the
            // consequence and carries the Sync control; the shelf names what is missing,
            // which is all a reason attached to a dead button owes.
            blocked={blockedBy}
            onPress={() =>
              router.push({ pathname: "/closeout", params: { shiftId: shift.id } })
            }
          />
          </>
        ) : (
          <Punch
            label="Open a shift"
            icon="play-circle-outline"
            busy={busy}
            busyLabel="Opening"
            onPress={async () => {
              setBusy(true);
              try {
                await openShift(driver, {
                  // expo-crypto, because `crypto.randomUUID` is a Node global that Hermes
                  // does not have. The engine requires this id rather than defaulting it,
                  // so that the missing global is a type error here instead of a crash in
                  // a market.
                  id: randomUUID(),
                  collectorId: collector.id,
                  businessDate: businessDate(),
                });
              } finally {
                setBusy(false);
                await load();
              }
            }}
          />
        )
      }
    >
      {shift ? (
        <Hero>
          <Figure
            on="hero"
            label={`Taken this shift · ${totals.count} receipt${totals.count === 1 ? "" : "s"}`}
            value={fromWire(totals.total)}
            absent="This tablet cannot read its own total for this shift. Do not close out — tell the office."
          />
          {/* A clock time, not the wire value. `clockTime` returns null rather than a
              guess, and then the screen says it has no time instead of printing one. */}
          <Group gap={6}>
            <Label tone={color.onHeroMuted}>
              {clockTime(shift.opened_at)
                ? `Open since ${clockTime(shift.opened_at)}`
                : "Open on this tablet"}
            </Label>
          </Group>
        </Hero>
      ) : (
        <>
          <Card>
            <Group gap={8}>
              <Icon name="briefcase-clock-outline" tone={color.primary} size={32} />
              <Body>No shift is open on this tablet for you.</Body>
              <Body tone={color.muted}>Open one below to start the round.</Body>
            </Group>
          </Card>
          {/* The round is hidden with no shift open, and the history must stay reachable after
              closeout -- that is when a collector most wants to check a day. */}
          <Rift h={16} />
          <TileGrid>
            <Tile icon="history" label="Transaction history" hint="Your receipts" onPress={() => router.push("/history")} />
          </TileGrid>
        </>
      )}

      {shift ? (
        <>
          <Rift h={28} />
          <Label>The round</Label>
          <Rift h={10} />
          {/*
            A terminal, parking lot or slaughterhouse has no stalls and no tenants (parent
            §5.1): its round IS the fee screen. A collector assigned to any market sees the
            lease paths. No sites yet (no sync, no area) shows the market's, as before.
          */}
          {sites.length > 0 && !sites.some((site) => site.type === "market") ? (
            <TileGrid>
              <Tile icon="cash-plus" label="Collect a fee" hint="Quantity × rate" onPress={() => router.push("/ambulant")} />
              <Tile icon="file-cancel-outline" label="Spoil a form" hint="A mis-written OR" onPress={() => router.push("/spoil")} />
              <Tile icon="history" label="Transaction history" hint="Your receipts" onPress={() => router.push("/history")} />
            </TileGrid>
          ) : (
            <TileGrid>
              <Tile icon="qrcode-scan" label="Scan a tenant card" hint="Fastest" onPress={() => router.push("/scan")} />
              <Tile icon="store-search-outline" label="Collect from a stall" hint="Search by stall or name" onPress={() => router.push("/leases")} />
              <Tile icon="cash-plus" label="On-the-spot fee" hint="No lease needed" onPress={() => router.push("/ambulant")} />
              <Tile icon="file-cancel-outline" label="Spoil a form" hint="A mis-written OR" onPress={() => router.push("/spoil")} />
              <Tile icon="history" label="Transaction history" hint="Your receipts" onPress={() => router.push("/history")} />
            </TileGrid>
          )}
        </>
      ) : null}

      <Rift />

      {/*
        NO THIRD COPY. The shelf already carries the reason and, since the last round, the
        Sync control that resolves it. A fuller warning here was the one getting clipped
        mid-sentence, so the consequence moves to a single line beside the remedy rather
        than competing with it.
      */}
      {block?.kind === "queued" ? (
        <>
          <Body tone={color.muted}>
            A closeout sent now would be compared against a server that has not seen these.
          </Body>
          <Rift h={12} />
        </>
      ) : block?.kind === "earlier_close" ? (
        <>
          <Body tone={color.muted}>
            Everything after it waits on this tablet until a supervisor puts it right. Tell
            the office.
          </Body>
          <Rift h={12} />
        </>
      ) : null}

      {shift && refused && !block ? (
        <>
          <Statement tone="warning" detail={refused.detail}>
            {refused.status === "mismatch"
              ? "Your last closeout did not match the server's records. Close out again once a supervisor has reconciled them."
              : "The server refused your last closeout. Close out again, or tell a supervisor if it is refused again."}
          </Statement>
          <Rift h={12} />
        </>
      ) : null}

      <SyncHealthNotice />

      {message ? (
        <>
          <Statement tone={failed ? "refusal" : "confirmed"} detail={detail}>
            {message}
          </Statement>
          <Rift h={12} />
        </>
      ) : null}

      <Group>
        <Action label="Sync now" icon="sync" busy={busy} busyLabel="Syncing" onPress={() => void sync()} />
        <Action
          label="Sign out"
          icon="logout"
          tone="danger"
          onPress={() => {
            // Clears a session, never data (parent §6.4). The outbox and every local shift
            // stay exactly where they are.
            signOut();
            router.replace("/sign-in");
          }}
        />
      </Group>
    </Screen>
  );
}
