import { format, type Centavos } from "@ceedo/shared";

/**
 * Right-aligned and tabular-nums so columns of figures line up on the decimal point.
 * A zero renders as a dash: in an aging table, an empty bucket and a bucket holding zero
 * pesos mean the same thing, and a column of "₱0.00" hides the figures that matter.
 *
 * Uses `text-neutral-500`, not a `text-muted-foreground` theme token: this app has no
 * shadcn/CSS-variable theme (see resource-table.tsx, layout.tsx), only plain Tailwind
 * neutral shades, so a "muted-foreground" class would resolve to nothing and print in the
 * default (unmuted) color.
 */
export function Money({ amount, muted }: { amount: Centavos; muted?: boolean }) {
  if (amount === 0) {
    return <span className="tabular-nums text-right text-neutral-500">—</span>;
  }
  return (
    <span className={`tabular-nums text-right ${muted ? "text-neutral-500" : ""}`}>
      {format(amount)}
    </span>
  );
}
