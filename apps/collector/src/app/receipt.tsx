import { useCallback, useEffect, useState } from "react";
import { useRouter } from "expo-router";
import { randomUUID } from "expo-crypto";
import {
  format,
  formatSerial,
  parseOrNo,
  validateOrEntry,
  type OrEntryContext,
  type OrEntryResult,
} from "@ceedo/shared";
import { commitReceipt, orEntryContext } from "@ceedo/sync-engine";
import {
  Action,
  Amount,
  Field,
  Figure,
  Group,
  Note,
  Punch,
  PunchMark,
  RackHead,
  Rift,
  Screen,
  Statement,
} from "../ui";
import { deviceDriver } from "../db/driver";
import { signedIn } from "../auth/session";
import { clearDraft, draft } from "../collect/draft";

/**
 * The OR number goes in AFTER the money is counted and the paper receipt is written.
 *
 * There is no printer. The receipts are pre-printed accountable forms the collector
 * carries; the app records a number that already exists on paper in the tenant's hand
 * (spec §1.2). So this screen's job is to validate a serial, not to issue one.
 *
 * A SEQUENCE SKIP IS A WARNING THE COLLECTOR CAN ACCEPT, never a block: parent §7.1 says
 * booklets legitimately get skipped, and a warning that fires on correct behaviour is one
 * that gets ignored on the day it is right. `ambiguous_booklet` IS a hard stop, because a
 * silently wrong booklet id on a real receipt is unrecoverable once the vendor walks away.
 *
 * THE PUNCH IS HERE. A serial that validates settles into the spent state with a punch
 * mark -- the conductor's punch biting the ticket. It is the only motion in the app, and
 * it marks the one genuinely irreversible moment in the round.
 */
export default function Receipt() {
  const router = useRouter();
  const driver = deviceDriver();
  const collector = signedIn();
  const pending = draft();

  const [context, setContext] = useState<OrEntryContext | null>(null);
  const [contextError, setContextError] = useState<string | null>(null);
  const [contextDetail, setContextDetail] = useState<string | null>(null);
  const [orText, setOrText] = useState("");
  const [check, setCheck] = useState<OrEntryResult | null>(null);
  const [acceptedSkip, setAcceptedSkip] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);

  // Named so the "Try again" button below can call the exact same load rather than
  // duplicating it. If this read fails, `context` stays null and Record would otherwise
  // stay disabled with nothing on screen saying why -- the same shape as the PIN-screen
  // stranding bug from the previous phase, just relocated. So it always resolves one way
  // or the other: either a context, or a stated reason plus a way to retry.
  const loadContext = useCallback(() => {
    if (!collector) return;
    setContextError(null);
    setContextDetail(null);
    orEntryContext(driver, collector.id)
      .then(setContext)
      .catch((caught: unknown) => {
        setContextError("Could not load your booklets.");
        setContextDetail(String(caught));
      });
  }, [collector, driver]);

  useEffect(() => {
    loadContext();
  }, [loadContext]);

  // ONE effect drives validation, keyed on both the typed text and the booklet context,
  // rather than validating only from the TextInput's onChangeText. `check === null` used
  // to conflate two causes: "not a valid number yet" and "context has not loaded yet". A
  // collector who types a complete, valid OR number before orEntryContext resolves would
  // see a dead Record button that self-heals only on the NEXT keystroke -- there might not
  // be one, since they already finished typing. Keying this off `context` too means a
  // number already sitting in the field is evaluated the instant the booklets arrive, with
  // no further input required.
  //
  // `parseOrNo`, never `Number.parseInt`: parseInt("1005x", 10) is 1005, and this screen
  // would then have ENABLED Record and written 1005 against whatever the paper actually
  // says. The non-empty-but-not-a-number state gets its own message below rather than
  // leaving the button dead with nothing said.
  useEffect(() => {
    setAcceptedSkip(false);
    const orNo = parseOrNo(orText);
    if (!context || orNo === null) {
      setCheck(null);
      return;
    }
    setCheck(validateOrEntry(context, orNo));
  }, [context, orText]);

  if (!collector) {
    return (
      <Screen head={<RackHead title="Record a receipt" onBack={() => router.back()} />}>
        <Note>Sign in first.</Note>
      </Screen>
    );
  }
  if (!pending) {
    return (
      <Screen head={<RackHead title="Record a receipt" onBack={() => router.back()} />}>
        <Note>Nothing to record. Start from the shift screen.</Note>
      </Screen>
    );
  }

  const reason = (result: OrEntryResult): string => {
    if (result.ok) return "";
    switch (result.reason) {
      case "not_in_assigned_booklet":
        return "That number is not inside any booklet assigned to you.";
      case "already_consumed":
        return "That number has already been used.";
      case "marked_spoiled":
        return "That number is marked spoiled.";
      case "ambiguous_booklet":
        return "That number falls inside two of your booklets. Check the form type before writing it.";
    }
  };

  // A lookup that tolerates a miss, rather than the two non-null assertions the brief's
  // draft used. When check.ok is true, its bookletId did come from context.booklets --
  // but the compiler cannot see that connection through state, and asserting it twice in
  // a render path is exactly how a crash gets written later. If this ever fails to find a
  // match (it should not), the screen just withholds the confirmation line instead of
  // throwing -- the Record button is still gated on `check.ok`, not on this lookup.
  const matchedBooklet =
    check?.ok ? context?.booklets.find((b) => b.id === check.bookletId) : undefined;

  // Parsed once and reused, so the echoed serial, the recorded serial and the validated
  // serial cannot be three different numbers.
  const orNo = parseOrNo(orText);
  const notANumber = orText.trim() !== "" && orNo === null;
  const skipUnconfirmed = check?.ok === true && check.warning === "sequence_skipped" && !acceptedSkip;

  /**
   * Why the receipt cannot be recorded yet, naming only what this screen has actually
   * checked. `check === null` conflates three different situations and each one gets its
   * own sentence: the booklets failed to load, the booklets have not arrived yet, or
   * nothing usable has been typed. Saying "enter the OR number" to a collector whose
   * booklet read just failed would name a cause that is not the cause.
   */
  const blocked: string | null = contextError
    ? "Your booklets could not be loaded. Try again above."
    : !context
      ? "Waiting for your booklets to load."
      : notANumber
        ? "An OR number is digits only."
        : orNo === null
          ? "Enter the number printed on the receipt you just wrote."
          : check === null
            ? "Checking that number against your booklets."
            : !check.ok
              ? reason(check)
              : skipUnconfirmed
                ? "Confirm the skipped number above."
                : null;

  return (
    <Screen
      head={
        <RackHead
          title={pending.kind === "lease" ? pending.stallNo : "On-the-spot fee"}
          subtitle={pending.kind === "lease" ? pending.tenantName : pending.label}
          onBack={() => router.back()}
        />
      }
      shelf={
        <Punch
          label="Record this receipt"
          blocked={blocked}
          busy={busy}
          busyLabel="Recording"
          onPress={async () => {
            if (!check?.ok || orNo === null) return;
            setBusy(true);
            setError(null);
            setErrorDetail(null);
            try {
              const shifts = await driver.select<{ id: string }>(
                "select id from local_shifts where collector_id = ? and status = 'open' order by opened_at desc",
                [collector.id],
              );
              const shiftId = shifts[0]?.id;
              if (!shiftId) {
                setError("This shift is no longer open. Open one from the shift screen.");
                return;
              }

              await commitReceipt(
                driver,
                {
                  id: randomUUID(),
                  orNo,
                  bookletId: check.bookletId,
                  collectorId: collector.id,
                  shiftId,
                  collectedAt: new Date().toISOString(),
                  feeTypeId: pending.feeTypeId,
                  leaseId: pending.kind === "lease" ? pending.leaseId : null,
                  grossAmount: pending.grossAmount,
                  ranks: pending.kind === "lease" ? pending.ranks : [],
                  allocations: pending.kind === "lease" ? pending.allocations : [],
                  lines: pending.kind === "lines" ? pending.lines : [],
                  payerRef: null,
                  notes: null,
                },
                pending.kind === "lines" ? pending.lines.map(() => randomUUID()) : [],
              );

              clearDraft();
              router.replace("/shift");
            } catch (caught) {
              // Nothing was written -- commitReceipt is one transaction. Saying so matters:
              // the collector needs to know whether to write another paper receipt.
              setError(
                "Not recorded, and nothing was saved. Write the paper receipt again on a new form, or try once more.",
              );
              setErrorDetail(String(caught));
            } finally {
              setBusy(false);
            }
          }}
        />
      }
    >
      {/* The amount leads: it is what the collector has just counted and is about to
          write onto the paper, and this screen exists only because that paper is real. */}
      <Group gap={10}>
        <Figure label="Amount received" value={format(pending.grossAmount)} />
        {pending.kind === "lease" && pending.change > 0 ? (
          <Amount label="Change" value={format(pending.change)} tone="confirmed" />
        ) : null}
      </Group>

      <Rift />

      <Field
        label="Write the receipt, then enter its number"
        voice="figure"
        keyboardType="number-pad"
        placeholder="OR number"
        value={orText}
        onChangeText={setOrText}
      />

      <Rift h={16} />

      {contextError ? (
        <Statement
          tone="refusal"
          detail={contextDetail}
          action={<Action label="Try again" onPress={loadContext} />}
        >
          {contextError}
        </Statement>
      ) : !context ? (
        <Note>Loading your booklets…</Note>
      ) : null}

      {notANumber ? (
        <Statement tone="refusal">
          An OR number is digits only. Type the number exactly as it is printed on the form.
        </Statement>
      ) : null}

      {check && !check.ok ? <Statement tone="refusal">{reason(check)}</Statement> : null}

      {/* THE PUNCH. The serial validated; the ticket is bitten. */}
      {check?.ok && matchedBooklet && orNo !== null ? (
        <PunchMark serial={formatSerial(matchedBooklet.serialPrefix, orNo)} />
      ) : null}

      {skipUnconfirmed ? (
        <>
          <Rift h={12} />
          <Statement
            tone="warning"
            action={
              <Action
                label="Yes, that is the number written"
                onPress={() => setAcceptedSkip(true)}
              />
            }
          >
            This skips one or more numbers in the booklet. That is allowed — confirm it is
            what the paper shows.
          </Statement>
        </>
      ) : null}

      {error ? (
        <>
          <Rift h={12} />
          <Statement tone="refusal" detail={errorDetail}>
            {error}
          </Statement>
        </>
      ) : null}
    </Screen>
  );
}
