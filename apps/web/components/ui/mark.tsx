import type { ReactNode } from "react";
import { cn } from "./cn";

/*
 * State marks — the world's substitute for the coloured pill.
 *
 * Two rules, both inherited from the direction's raises: colour never fills the ground
 * behind a figure, and no state is signalled by colour alone. So a mark is a ruled box
 * with its own word in it, and where a state is urgent it also carries a solid ink bar in
 * the gutter of its row (see `DataTable`'s `rowMark`).
 */
export type MarkTone = "neutral" | "alert" | "warn" | "proof" | "office";

const TONES: Record<MarkTone, string> = {
  neutral: "border-rule-strong bg-tape-sunk text-ink-2",
  alert: "border-ribbon/45 bg-ribbon-soft text-ribbon",
  warn: "border-amber/40 bg-amber-soft text-amber",
  proof: "border-proof/35 bg-proof-soft text-proof",
  office: "border-mark/35 bg-mark-soft text-mark",
};

export function Mark({
  tone = "neutral",
  children,
  className,
}: {
  tone?: MarkTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-[2px] border px-1.5 py-[3px]",
        "text-2xs font-semibold uppercase tracking-[0.06em] leading-none whitespace-nowrap",
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** A quiet state that needs no box: "Posted", "Closed", "Open". */
export function QuietMark({ children }: { children: ReactNode }) {
  return <span className="text-xs text-ink-3">{children}</span>;
}
