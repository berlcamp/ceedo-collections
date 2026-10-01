import { format, type Centavos } from "@ceedo/shared";

/**
 * What the close form shows after `closeRecoveredShift` succeeds. Pulled out of the
 * component as a pure function so the three cases -- balanced, short, over -- are
 * unit-tested directly rather than only discoverable by reading the rendered page.
 *
 * `variance` is signed the same way `office_close_shift` returns it: negative is short
 * (less cash handed over than the system total), positive is over.
 */
export interface CloseNotice {
  tone: "success" | "warning";
  message: string;
  /** Only a short close links to Shortages -- an admin settles that there, not here. */
  shortageLink: boolean;
}

export function closeNotice(variance: Centavos): CloseNotice {
  if (variance === 0) return { tone: "success", message: "Balanced.", shortageLink: false };
  if (variance < 0) {
    const short = format(Math.abs(variance) as Centavos);
    return {
      tone: "warning",
      message: `Short ${short} — record repayments under Shortages.`,
      shortageLink: true,
    };
  }
  return { tone: "warning", message: `Over ${format(variance)}.`, shortageLink: false };
}
