import { useCallback, useState } from "react";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { View } from "react-native";
import {
  format,
  fromCentavos,
  parsePesoInput,
  selectByAmount,
  sum,
  type Centavos,
  type PeriodGroup,
} from "@ceedo/shared";
import { leaseLedgerDetail } from "@ceedo/sync-engine";
import {
  Action,
  Amount,
  Body,
  Field,
  Figure,
  Label,
  Note,
  Punch,
  RackHead,
  Register,
  Rift,
  Rule,
  Screen,
  Slot,
  Statement,
  missing,
} from "../../ui";
import { syncFailure } from "../../ui/failures";
import { freshness, type Freshness } from "../../ui/staleness";
import { deviceDriver } from "../../db/driver";
import { setDraft } from "../../collect/draft";
import { businessDate, syncNow } from "../../sync/device-sync";

interface Header {
  stall_no: string;
  tenant_name: string;
  // `leases` carries no fee_type_id column -- migration 20260917000004_tenants_leases.sql
  // never gave it one, and only `charges` does (20260918000011_ledger_charges.sql). Every
  // charge on a lease is stamped from that lease's one rate, so any of its charges names
  // the right fee type; a lease with none yet (nothing accrued) reports null here, and
  // that lease also has no outstanding groups, so the button below never needs it.
  fee_type_id: string | null;
}

/**
 * What this tenant owes, oldest first, and the two ways to choose how much of it is being
 * paid. Spec F6.
 *
 * BOTH MODES PRODUCE ONE ARTEFACT: a set of ranks 1..n. Tapping the fifth row selects one
 * through five; typing a peso figure runs selectByAmount. The payload, the validation and
 * the server path are then identical, so the second mode is a second way in rather than a
 * second code path to the wire.
 *
 * THE RACK IS WHAT MAKES FIFO VISIBLE. The oldest period is anchored at the top and a
 * selection fills downward as one unbroken ochre spine, so "you cannot pay March before
 * February" is a physical property of the screen rather than a rule the code enforces
 * where nobody can see it. Unselected periods drop back in ink once a run exists --
 * suppressed, never hidden, because a period a collector cannot read is a period they
 * cannot check.
 *
 * THE STALENESS LINE IS NOT DECORATION (spec F7). The collector writes the paper OR by
 * hand from the figure on this screen, and the paper is what the tenant walks away
 * holding. If another tablet settled a group since this device last pulled, the ranks name
 * different periods than were quoted and the amount recorded will differ from the cash
 * taken. The device cannot detect that -- it is caught at closeout, which blocks -- so what
 * this screen owes is an honest statement of how old its numbers are. It is stated twice on
 * purpose: a pip in the masthead that cannot scroll away, and the full sentence plus its
 * remedy in the body.
 */
export default function Lease() {
  const { leaseId } = useLocalSearchParams<{ leaseId: string }>();
  const router = useRouter();
  const driver = deviceDriver();

  const [header, setHeader] = useState<Header | null>(null);
  const [groups, setGroups] = useState<PeriodGroup[]>([]);
  const [perCharge, setPerCharge] = useState<Map<string, Centavos>>(new Map());
  const [ranks, setRanks] = useState<number[]>([]);
  const [tendered, setTendered] = useState("");
  const [fresh, setFresh] = useState<Freshness | null>(null);
  const [busy, setBusy] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [syncDetail, setSyncDetail] = useState<string | null>(null);

  const load = useCallback(async () => {
    const rows = await driver.select<Header>(
      `select s.stall_no, t.full_name as tenant_name,
              (select c.fee_type_id from charges c where c.lease_id = l.id limit 1)
                as fee_type_id
         from leases l
         join stalls s on s.id = l.stall_id
         join tenants t on t.id = l.tenant_id
        where l.id = ?`,
      [leaseId],
    );
    setHeader(rows[0] ?? null);
    const detail = await leaseLedgerDetail(driver, leaseId);
    setGroups(detail.groups);
    setPerCharge(detail.perCharge);
    setFresh(await freshness(driver, businessDate()));
  }, [driver, leaseId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const selected = groups.filter((g) => ranks.includes(g.groupRank));
  const gross = sum(selected.map((g) => g.outstanding));
  const balance = sum(groups.map((g) => g.outstanding));

  /** Tapping row n selects rows 1..n. FIFO is enforced by construction (parent §8.3). */
  const tapRow = (rank: number) => {
    setTendered("");
    setRanks(ranks.length === rank ? [] : Array.from({ length: rank }, (_, i) => i + 1));
  };

  const applyAmount = (text: string) => {
    setTendered(text);
    if (text.trim() === "") return setRanks([]);
    let cash: Centavos;
    try {
      cash = parsePesoInput(text);
    } catch {
      return setRanks([]);
    }
    setRanks(selectByAmount(groups, cash).selected.map((g) => g.groupRank));
  };

  // Parsed once, so the "does not cover" message below can show the SAME figure `change`
  // is computed from rather than re-parsing `tendered` a second time unguarded. A
  // half-typed decimal ("." on the decimal pad, before the digits after it land) fails
  // parsePesoInput -- Number(".") is NaN -- and re-parsing it in the render, rather than
  // reusing this guarded value, would crash the screen mid-keystroke instead of just
  // waiting for a valid figure.
  const tenderedCentavos = (() => {
    if (tendered.trim() === "") return null;
    try {
      return parsePesoInput(tendered);
    } catch {
      return null;
    }
  })();

  const change =
    tenderedCentavos === null ? fromCentavos(0) : fromCentavos(tenderedCentavos - gross);

  const shortOfOldest = tenderedCentavos !== null && ranks.length === 0 && groups.length > 0;

  if (!header) {
    return (
      <Screen head={<RackHead title="Lease" onBack={() => router.back()} />}>
        <Note>This lease is not on this tablet.</Note>
      </Screen>
    );
  }

  // See the Header comment: a lease with any outstanding group necessarily has at least
  // one charge, so fee_type_id is only null when groups is empty and the button below is
  // disabled anyway. Read once here so the onPress closure below is typed non-null.
  const feeTypeId = header.fee_type_id;

  // Both reasons, never whichever is checked first: a collector told only "choose the
  // periods" on a lease that has no charges on this tablet would tap rows that are not
  // there until they gave up.
  const blocked = missing(
    ranks.length === 0 &&
      "Choose the periods being paid, or enter the amount the tenant handed over.",
    feeTypeId === null && "This lease has no charges on this tablet yet — sync first.",
  );

  return (
    <Screen
      head={
        <RackHead
          title={header.stall_no}
          subtitle={header.tenant_name}
          onBack={() => router.back()}
          register={fresh ? <Register state={fresh.state} detail={fresh.short} /> : undefined}
        />
      }
      shelf={
        <>
          {/*
            THE FARE PANEL LIVES ON THE SHELF, NOT IN THE SCROLL.

            It was at the end of the body, and on a narrow screen that put it below the
            fold at the exact moment it changed: tapping a period updated the one figure
            the collector is about to hand-write onto a paper Official Receipt, and that
            figure was half-clipped by this shelf when it did. Pinned here it is always
            visible, at the largest type in the app, immediately above the control that
            commits it.
          */}
          <Figure label="Receipt total" value={format(gross)} />
          {ranks.length > 0 && change > 0 ? (
            <Amount label="Change" value={format(change)} tone="confirmed" />
          ) : null}
          <Punch
            label="Proceed to payment"
            blocked={blocked}
          onPress={() => {
            if (feeTypeId === null) return;
            setDraft({
              kind: "lease",
              leaseId,
              feeTypeId,
              stallNo: header.stall_no,
              tenantName: header.tenant_name,
              groups,
              ranks,
              // Per CHARGE, not per group: local_allocations is keyed
              // (collection_id, charge_id) so Task 4's overlay subtracts exactly what was
              // settled. perCharge comes from leaseLedgerDetail, the same read that
              // produced these groups, so the two cannot disagree.
              allocations: selected.flatMap((g) =>
                g.chargeIds.map((chargeId) => ({
                  chargeId,
                  amount: perCharge.get(chargeId) ?? fromCentavos(0),
                })),
              ),
              grossAmount: gross,
              change,
            });
            router.push("/receipt");
          }}
          />
        </>
      }
    >
      <Amount label="Balance" value={format(balance)} />

      {fresh && fresh.state !== "fresh" ? (
        <>
          <Rift h={16} />
          <Statement
            tone={fresh.state === "never" ? "refusal" : "warning"}
            action={
              <Action
                label="Sync now"
                busy={busy}
                busyLabel="Syncing"
                onPress={async () => {
                  setBusy(true);
                  setSyncMessage(null);
                  try {
                    await syncNow();
                    await load();
                    setRanks([]);
                    setTendered("");
                  } catch (error) {
                    // `syncNow()` THROWS, and it throws in exactly the situation this
                    // button exists for: no signal, or no credential. This is F7's
                    // disclosure remedy -- the collector taps it BECAUSE the line above
                    // worried them -- so swallowing the failure leaves the same stale date
                    // on screen with nothing said, and they write the paper receipt from
                    // figures they now believe are fresh. Same wording as shift.tsx:
                    // never fatal, parent §3.
                    const said = syncFailure(error);
                    setSyncMessage(said.said);
                    setSyncDetail(said.detail);
                  } finally {
                    setBusy(false);
                  }
                }}
              />
            }
          >
            {fresh.full}
          </Statement>
          {syncMessage ? (
            <>
              <Rift h={10} />
              <Statement tone="refusal" detail={syncDetail}>
                {syncMessage}
              </Statement>
            </>
          ) : null}
        </>
      ) : fresh && fresh.pendingCount > 0 ? (
        <>
          <Rift h={16} />
          <Statement tone="notice">{fresh.full}</Statement>
        </>
      ) : null}

      <Rift h={24} />

      <Label>Outstanding, oldest first</Label>
      <View style={{ height: 8 }} />

      {groups.length === 0 ? (
        <Note>Nothing outstanding.</Note>
      ) : (
        <>
          <Rule />
          {groups.map((group) => {
            const on = ranks.includes(group.groupRank);
            return (
              <View key={group.groupRank}>
                <Slot
                  onPress={() => tapRow(group.groupRank)}
                  selected={on}
                  suppressed={ranks.length > 0 && !on}
                  // Two lines by construction rather than by wrapping: one line held
                  // "2026-06-01 · due 2026-06-05" beside an amount and broke mid-phrase
                  // on a narrow screen, which put "due" on one line and its date on the
                  // next.
                  left={
                    <View style={{ gap: 2 }}>
                      <Body>{group.periodStart}</Body>
                      <Label>{`Due ${group.dueDate}`}</Label>
                    </View>
                  }
                  right={format(group.outstanding)}
                />
                <Rule />
              </View>
            );
          })}
        </>
      )}

      <Rift h={28} />

      <Field
        label="Or enter what the tenant is handing over"
        voice="figure"
        keyboardType="decimal-pad"
        placeholder="0.00"
        value={tendered}
        onChangeText={applyAmount}
      />

      {shortOfOldest && tenderedCentavos !== null ? (
        <>
          <Rift h={12} />
          <Statement tone="refusal">
            {`${format(tenderedCentavos)} does not cover the oldest period (${format(
              groups[0]!.outstanding,
            )}). Whole periods only — there is no part payment.`}
          </Statement>
        </>
      ) : null}

      {/*
        Change appears on the shelf only when a run is actually selected AND it is
        positive. A "Change ₱200.00" line once appeared beside "Receipt total ₱0.00" and a
        warning, all at once, because the change was computed from an empty selection -- a
        figure derived from nothing, rendered as money.
      */}
      {ranks.length > 0 ? (
        <>
          <Rift h={12} />
          <Body>
            {`${ranks.length} period${ranks.length === 1 ? "" : "s"} selected, oldest first.`}
          </Body>
        </>
      ) : null}
    </Screen>
  );
}
