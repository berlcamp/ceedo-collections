import { useCallback, useState } from "react";
import { useFocusEffect, useRouter } from "expo-router";
import { Text, View } from "react-native";
import {
  format,
  multiply,
  parsePesoInput,
  resolveRate,
  RateNotFoundError,
  sum,
  type RateRow,
} from "@ceedo/shared";
import {
  collectorSites,
  feeChoices,
  payerPrompt,
  type CollectorSite,
  type DraftLine,
  type FeeChoice,
} from "@ceedo/sync-engine";
import { signedIn } from "../auth/session";
import {
  Action,
  Body,
  Field,
  Figure,
  Label,
  LinkButton,
  List,
  Note,
  Punch,
  RackHead,
  Rift,
  Screen,
  Slot,
  Statement,
  color,
  face,
  size,
} from "../ui";
import { syncFailure } from "../ui/failures";
import { deviceDriver } from "../db/driver";
import { setDraft } from "../collect/draft";
import { businessDate, syncNow } from "../sync/device-sync";
import { useHoldAutoSync } from "../sync/useAutoSync";

/**
 * On-the-spot fees: quantity x rate, no lease and no receivable. Parent §2's ambulant /
 * daily vendor fee, and the same shape Phase 5's terminal and slaughterhouse receipts need
 * -- which is why it is built here rather than deferred with them.
 *
 * Leaving it out would not defer the work. It would move half the round onto paper, and
 * the device's consumed-serial set would then diverge from the booklet it validates
 * against, so honest receipts would start raising sequence-skip warnings.
 *
 * resolveRate THROWS rather than choosing when two rates overlap. Here that becomes a
 * refusal the collector can read and a supervisor can act on -- never a crash at a stall.
 * The rates are stale-able local data, and a tablet that has not pulled a new ordinance's
 * rate row must say so rather than price the receipt itself.
 *
 * RateRow.rateClass is `string`, never null -- "" means unclassified (rates.ts:14). The
 * `rates` column IS nullable in the local SQLite mirror, so the load below normalises with
 * `?? ""` when mapping rows out of it. DraftLine.rateClass, by contrast, is
 * `string | null`, and commitReceipt omits `rate_class` from the payload entirely for
 * `null` while sending it verbatim for a string -- including the empty one.
 *
 * IN PRACTICE AN UNCLASSIFIED LINE SHIPS `rate_class: ""`, NOT AN OMITTED KEY. Server-side
 * `rates.rate_class` is `text not null default ''`, so nothing upstream ever produces a
 * genuine null and the `?? ""` above is defensive rather than load-bearing. That is
 * harmless -- `post_collection` coalesces, and CollectionPayload declares
 * `z.string().optional()`, which "" satisfies -- but it is worth stating plainly, because
 * this comment used to claim the null path was the real one and a reader could build on a
 * guarantee the data does not give. A picked fee's `rate_class` is passed through to its
 * DraftLine unchanged either way, which is what keeps the two representations honest.
 */
export default function Ambulant() {
  const router = useRouter();
  useHoldAutoSync();
  const driver = deviceDriver();
  const collector = signedIn();

  const [choices, setChoices] = useState<FeeChoice[]>([]);
  const [rates, setRates] = useState<RateRow[]>([]);
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [pick, setPick] = useState<FeeChoice | null>(null);
  const [qty, setQty] = useState("1");
  const [error, setError] = useState<string | null>(null);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sites, setSites] = useState<CollectorSite[]>([]);
  const [payerRef, setPayerRef] = useState("");

  // THROWS. Every caller must say so when it fails -- `useFocusEffect` below and the "Sync
  // now" retry both used to let the rejection vanish, and a collector cannot tell a failed
  // load from a failed sync from a screen that simply has no fee types on it.
  const load = useCallback(async () => {
    // Only the fees of the kinds of facility the collector is assigned to (Phase 5): the
    // terminal collector must not be offered the slaughterhouse's hog rate. The sites are
    // the signed-in collector's, since every tablet holds every facility.
    const here = collector ? await collectorSites(driver, collector.id) : [];
    setSites(here);
    setChoices(await feeChoices(driver, [...new Set(here.map((site) => site.type))]));
    setRates(
      (
        await driver.select<{
          id: string;
          fee_type_id: string;
          rate_class: string | null;
          effective_from: string;
          effective_to: string | null;
          amount: string;
          basis: RateRow["basis"];
        }>(
          "select id, fee_type_id, rate_class, effective_from, effective_to, amount, basis from rates",
        )
      ).map((r) => ({
        id: r.id,
        feeTypeId: r.fee_type_id,
        rateClass: r.rate_class ?? "",
        effectiveFrom: r.effective_from,
        effectiveTo: r.effective_to,
        amount: parsePesoInput(r.amount),
        basis: r.basis,
      })),
    );
  }, [collector, driver]);

  useFocusEffect(
    useCallback(() => {
      load().catch((caught: unknown) => {
        setError("Could not load the fee list from this tablet.");
        setErrorDetail(String(caught));
      });
    }, [load]),
  );

  const gross = sum(lines.map((l) => l.amount));

  // One fee type per receipt (review R12). parent §10's Abstract of Collections totals by
  // fee type off the collections row, and this screen's own `choices` query is not scoped
  // to one fee type -- it offers every non-accruing fee active on the tablet -- so nothing
  // upstream stops a collector tapping a different fee between "Add to receipt" presses.
  // Locking here, once the first line exists, is what makes that true rather than assumed.
  // A vehicle class (parent §2, Phase 5's terminal receipt) is a `rate_class` of ONE fee
  // type, so this still allows several classes of the SAME fee on one receipt -- only a
  // second fee type is refused.
  const lockedFeeTypeId = lines.length > 0 ? lines[0]!.feeTypeId : null;
  const lockedFeeName =
    lockedFeeTypeId === null
      ? null
      : (choices.find((c) => c.fee_type_id === lockedFeeTypeId)?.fee_name ?? lockedFeeTypeId);

  const addLine = () => {
    if (!pick) return;
    // Strict digit-string check, not just Number.parseInt: parseInt("3abc", 10) returns 3,
    // which would silently accept a mistyped quantity instead of rejecting it -- and no
    // partial input here may throw either, so this never touches Number() on garbage.
    const trimmed = qty.trim();
    const quantity = Number(trimmed);
    if (!/^\d+$/.test(trimmed) || !Number.isInteger(quantity) || quantity <= 0) {
      return setError("Quantity must be a whole number greater than zero.");
    }
    const named = `${pick.fee_name}${pick.rate_class ? ` (${pick.rate_class})` : ""}`;
    try {
      const rate = resolveRate(rates, pick.fee_type_id, businessDate(), pick.rate_class ?? "");
      setLines([
        ...lines,
        {
          feeTypeId: pick.fee_type_id,
          rateClass: pick.rate_class,
          quantity,
          unitRate: rate.amount,
          amount: multiply(rate.amount, quantity),
        },
      ]);
      setError(null);
      setQty("1");
    } catch (caught) {
      // Named precisely -- fee type, class, and date, for BOTH failure modes. "Not synced"
      // would be a guess, and 3b-i's device-found bug is what happens when a screen names a
      // cause it has not checked. The ambiguous-rates Error from resolveRate names only the
      // raw fee type id and date, not the class or a human name, so it is wrapped rather
      // than shown as-is; the raw message is kept in parentheses for whoever has to fix it.
      setError(
        caught instanceof RateNotFoundError
          ? `This tablet has no rate for ${named} as of ${businessDate()}. Sync, or ask the office whether the rate has been entered.`
          : `Two rates both cover ${named} on ${businessDate()}. This is a data problem, not something to guess past -- tell the office. (${String(caught)})`,
      );
    }
  };

  const resync = async () => {
    // `syncNow()` THROWS -- no signal, or no credential -- and this button is the remedy
    // resolveRate's own message directs the collector to, so it fails in exactly the
    // situation it exists for. Unhandled, the rate error simply stayed on screen and the
    // collector could not tell whether the sync had happened. The busy flag is the other
    // half: without it a double-tap sent two syncs. Same wording as shift.tsx; never
    // fatal, parent §3.
    setBusy(true);
    try {
      await syncNow();
      await load();
      setError(null);
    } catch (caught) {
      const said = syncFailure(caught);
      setError(said.said);
      setErrorDetail(said.detail);
    } finally {
      setBusy(false);
    }
  };

  // At a market this screen is the side door (ambulant vendors); at a terminal, parking
  // lot or slaughterhouse it is the whole round.
  const types = [...new Set(sites.map((site) => site.type))];
  const title = sites.length > 0 && !types.includes("market") ? "Collect a fee" : "On-the-spot fee";
  // The payer prompt fits one kind of site; a collector across kinds gets the plain one.
  const siteType = types.length === 1 ? types[0]! : null;

  return (
    <Screen
      head={
        <RackHead
          title={title}
          subtitle={
            lockedFeeName ?? (sites.map((site) => site.name).join(" · ") || "No lease, no receivable")
          }
          onBack={() => router.back()}
        />
      }
      shelf={
        <>
          {/* Pinned for the same reason as the lease screen's: this is the figure that
              gets hand-written onto the paper, and it must not be the thing that scrolls
              away as lines are added. */}
          <Figure label="Receipt total" value={format(gross)} inline />
          <Punch
            label="Proceed to payment"
            icon="arrow-right-circle-outline"
            blocked={lines.length === 0 ? "Add at least one line to the receipt." : null}
          onPress={() => {
            setDraft({
              kind: "lines",
              // Enforced by the choice guard below, not assumed: a tap on a different fee
              // type is refused before `pick` -- and so a line -- can hold it, so every
              // line here already shares one fee type by construction. That is what makes
              // lines[0] a safe stand-in for "the receipt's fee type", which is what
              // parent §10's Abstract of Collections totals by.
              feeTypeId: lines[0]!.feeTypeId,
              label: title,
              lines,
              grossAmount: gross,
              payerRef: payerRef.trim() === "" ? null : payerRef.trim(),
            });
            router.push("/receipt");
          }}
          />
        </>
      }
    >
      <Label>Fee</Label>
      <View style={{ height: 8 }} />

      {choices.length === 0 ? (
        <Note icon="tag-off-outline">
          No on-the-spot fees for your facilities. The office sets where each fee is collected,
          then sync.
        </Note>
      ) : (
        <List>
          {choices.map((choice) => {
            // Field comparison, not `pick === choice` (review, minor): `choices` is a
            // fresh array after every `load()` -- including the "Sync now" retry below --
            // so a reference check would drop the highlight on a still-valid pick and,
            // now that a mismatched tap is refused rather than a no-op, could read as
            // that refusal to a collector who never actually lost their selection.
            const isPicked =
              pick !== null &&
              pick.fee_type_id === choice.fee_type_id &&
              pick.rate_class === choice.rate_class;
            const isLockedOut =
              lockedFeeTypeId !== null && choice.fee_type_id !== lockedFeeTypeId;
            return (
                <Slot
                  key={`${choice.fee_type_id}|${choice.rate_class ?? ""}`}
                  selectable
                  selected={isPicked}
                  suppressed={isLockedOut}
                  left={`${choice.fee_name}${choice.rate_class ? ` · ${choice.rate_class}` : ""}`}
                  onPress={() => {
                    if (isLockedOut) {
                      // Named, not a silent no-op -- the stranding pattern this phase keeps
                      // finding. Says which fee the receipt is already for and what to do.
                      setError(
                        `This receipt is already for ${lockedFeeName}. ${choice.fee_name} needs its own receipt -- add it after this one is recorded.`,
                      );
                      return;
                    }
                    setError(null);
                    setPick(choice);
                  }}
                />
            );
          })}
        </List>
      )}

      <Rift h={24} />

      <Field
        label="Quantity"
        voice="figure"
        icon="counter"
        keyboardType="number-pad"
        value={qty}
        onChangeText={setQty}
      />
      <Rift h={12} />
      <Action
        label="Add to receipt"
        icon="plus"
        blocked={pick === null ? "Choose a fee above first." : null}
        onPress={addLine}
      />

      {error ? (
        <>
          <Rift h={16} />
          <Statement
            tone="refusal"
            detail={errorDetail}
            action={<Action label="Sync now" icon="sync" busy={busy} busyLabel="Syncing" onPress={() => void resync()} />}
          >
            {error}
          </Statement>
        </>
      ) : null}

      <Rift h={24} />
      {/* Optional (see payerPrompt): recorded as collections.payer_ref when given. */}
      <Field
        label={`${payerPrompt(siteType)} (optional)`}
        icon="account-outline"
        value={payerRef}
        onChangeText={setPayerRef}
        autoCapitalize={siteType === "terminal" || siteType === "parking" ? "characters" : "words"}
        autoCorrect={false}
      />

      {lines.length > 0 ? (
        <>
          <Rift />
          <Label>On this receipt</Label>
          <View style={{ height: 8 }} />
          <List>
          {lines.map((line, index) => (
              <Slot
                key={index}
                icon="receipt-text-outline"
                left={
                  <View style={{ gap: 2 }}>
                    <Body>{`${line.quantity} × ${format(line.unitRate)}`}</Body>
                    {line.rateClass ? (
                      <Body tone={color.muted}>{line.rateClass}</Body>
                    ) : null}
                  </View>
                }
                right={
                  <View style={{ alignItems: "flex-end", gap: 4 }}>
                    <Text style={lineAmount}>{format(line.amount)}</Text>
                    {/*
                      A mistyped quantity used to be unescapable. Combined with the
                      one-fee-type lock above, the FIRST line fixed both the fee type and
                      its own wrong amount for the lifetime of the screen -- the only way
                      out was navigating away and starting the receipt over. Removing the
                      last line empties `lines`, which releases the lock naturally, because
                      the lock is derived from `lines[0]` rather than stored.
                    */}
                    <LinkButton
                      label="Remove"
                      icon="trash-can-outline"
                      tone="danger"
                      accessibilityLabel={`Remove line ${index + 1}`}
                      onPress={() => {
                        setLines(lines.filter((_, i) => i !== index));
                        setError(null);
                      }}
                    />
                  </View>
                }
              />
          ))}
          </List>
        </>
      ) : null}

    </Screen>
  );
}

const lineAmount = {
  fontFamily: face.bold,
  fontSize: size.body,
  color: color.ink,
};
