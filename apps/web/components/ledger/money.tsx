import { format, type Centavos } from "@ceedo/shared";
import { cn } from "@/components/ui/cn";

/**
 * Right-aligned and tabular-nums so columns of figures line up on the decimal point.
 * A zero renders as a dash: in an aging table, an empty bucket and a bucket holding zero
 * pesos mean the same thing, and a column of "₱0.00" hides the figures that matter.
 *
 * Colour is deliberately absent. Proof Tape keeps the figure field achromatic and spends
 * its ink on the marks in the gutter and the variance under the close, so a peso amount
 * is never tinted by its own row's status — only muted when the row is void or settled.
 */
export function Money({ amount, muted }: { amount: Centavos; muted?: boolean }) {
  if (amount === 0) {
    return <span className="tabular-nums text-right text-ink-3">—</span>;
  }
  return (
    <span className={cn("tabular-nums text-right", muted ? "text-ink-3 line-through" : "text-ink")}>
      {format(amount)}
    </span>
  );
}
