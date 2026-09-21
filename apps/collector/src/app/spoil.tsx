import { useCallback, useEffect, useState } from "react";
import { useRouter } from "expo-router";
import { randomUUID } from "expo-crypto";
import { parseOrNo, validateOrEntry, type OrEntryContext } from "@ceedo/shared";
import { enqueue, orEntryContext } from "@ceedo/sync-engine";
import {
  Action,
  Body,
  Field,
  Note,
  Punch,
  RackHead,
  Rift,
  Screen,
  Statement,
  missing,
} from "../ui";
import { deviceDriver } from "../db/driver";
import { signedIn } from "../auth/session";

/**
 * A form written wrong is spoiled and a new one issued. Spec D4 (3b-i), unchanged.
 *
 * There is deliberately no way to cancel a POSTED collection from the tablet: a collector
 * who can cancel their own receipts can make a shortfall disappear. Cancelling stays a
 * supervisor act on the web. This screen is the collector's whole remedy, and it is the
 * same one the paper process already gives them.
 *
 * The serial must be one of theirs and not already used -- but a spoiled form is NOT a
 * consumed one, so validateOrEntry's `already_consumed` is a genuine refusal here: a
 * number that carries a real receipt cannot also be spoiled.
 */
export default function Spoil() {
  const router = useRouter();
  const driver = deviceDriver();
  const collector = signedIn();

  const [context, setContext] = useState<OrEntryContext | null>(null);
  const [contextError, setContextError] = useState<string | null>(null);
  const [contextDetail, setContextDetail] = useState<string | null>(null);
  const [orText, setOrText] = useState("");
  const [reason, setReason] = useState("");
  const [acceptedSkip, setAcceptedSkip] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Named so the "Try again" button can call the exact same load rather than duplicating
  // it. If this read fails, `context` stays null and "Mark spoiled" would otherwise stay
  // disabled with nothing on screen saying why -- the same stranding shape receipt.tsx
  // guards against. So it always resolves one way or the other: either a context, or a
  // stated reason plus a way to retry.
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

  if (!collector) {
    return (
      <Screen head={<RackHead title="Spoil a form" onBack={() => router.back()} />}>
        <Note>Sign in first.</Note>
      </Screen>
    );
  }

  // `parseOrNo`, never `Number.parseInt`. parseInt("1005x", 10) is 1005, and THIS screen
  // echoes nothing back, so a truncated serial here would be marked spoiled with no cash
  // trail to contradict it -- it surfaces only at booklet reconciliation, much later, by
  // someone else. So a non-empty field that is not a number says so, rather than leaving
  // the button dead and unexplained.
  const orNo = parseOrNo(orText);
  const notANumber = orText.trim() !== "" && orNo === null;
  const check = context && orNo !== null ? validateOrEntry(context, orNo) : null;
  const reasonGiven = reason.trim() !== "";

  // A skip is a warning here for the same reason it is on receipt.tsx -- booklets
  // legitimately get skipped -- but the cost of a mistyped serial is worse on THIS
  // screen: a wrong-serial receipt disagrees with a cash trail (amount, tenant,
  // closeout); a wrong-serial spoil leaves no trail at all until the booklet is
  // reconciled, much later, by someone else. So an out-of-sequence serial is
  // confirmable, never silent and never a hard block.
  const skipUnconfirmed =
    check?.ok === true && check.warning === "sequence_skipped" && !acceptedSkip;

  const refusal =
    check && !check.ok
      ? check.reason === "already_consumed"
        ? "That number carries a receipt already. It cannot be spoiled."
        : check.reason === "marked_spoiled"
          ? "That number is already marked spoiled."
          : check.reason === "ambiguous_booklet"
            ? "That number falls inside two of your booklets. Check the form type before spoiling it."
            : "That number is not inside any booklet assigned to you."
      : null;

  /**
   * BOTH REASONS, NOT WHICHEVER IS CHECKED FIRST. A collector who has typed a good serial
   * but no reason, and a collector who has typed neither, need different sentences — and
   * the second needs both of them, or they fix one thing and the button stays dead.
   */
  const blocked = contextError
    ? "Your booklets could not be loaded. Try again above."
    : !context
      ? "Waiting for your booklets to load."
      : missing(
          notANumber
            ? "An OR number is digits only."
            : orNo === null
              ? "Enter the number printed on the form you are spoiling."
              : (refusal ?? (skipUnconfirmed ? "Confirm the skipped number above." : null)),
          !reasonGiven && "Give a reason.",
        );

  return (
    <Screen
      head={
        <RackHead
          title="Spoil a form"
          subtitle="Accounted for on return"
          onBack={() => router.back()}
        />
      }
      shelf={
        <Punch
          label="Mark spoiled"
          blocked={blocked}
          busy={busy}
          busyLabel="Recording"
          onPress={async () => {
            if (!check?.ok || orNo === null || !reasonGiven || skipUnconfirmed) return;
            setBusy(true);
            setError(null);
            setErrorDetail(null);
            try {
              await enqueue(driver, {
                id: randomUUID(),
                type: "spoiled_form",
                payload: {
                  booklet_id: check.bookletId,
                  or_no: orNo,
                  collector_id: collector.id,
                  reason: reason.trim(),
                },
                collectorId: collector.id,
              });
              router.replace("/shift");
            } catch (caught) {
              setError("Not recorded. Nothing was saved — try again.");
              setErrorDetail(String(caught));
            } finally {
              setBusy(false);
            }
          }}
        />
      }
    >
      <Body>
        The form stays in the booklet and is accounted for on return: used + spoiled +
        unused must equal the total serials.
      </Body>

      <Rift />

      <Field
        label="OR number"
        voice="figure"
        keyboardType="number-pad"
        placeholder="OR number"
        value={orText}
        onChangeText={(text) => {
          setOrText(text);
          setAcceptedSkip(false);
          setError(null);
        }}
      />

      <Rift h={16} />

      <Field
        label="Why"
        placeholder="Torn, misprinted…"
        value={reason}
        onChangeText={(text) => {
          setReason(text);
          setError(null);
        }}
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

      {refusal ? <Statement tone="refusal">{refusal}</Statement> : null}

      {skipUnconfirmed ? (
        <>
          <Rift h={12} />
          <Statement
            tone="warning"
            action={
              <Action
                label="Yes, that is the form in my hand"
                onPress={() => setAcceptedSkip(true)}
              />
            }
          >
            This skips one or more numbers in the booklet. That is allowed — confirm the
            number you typed matches the form you are holding.
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
