import type { ReactNode } from "react";

/**
 * The header band. Fixed in the frame's grammar: name on the left, the screen's own
 * actions on the right, the standing note beneath. It holds across every route so only
 * the tape below it swaps — the discipline this direction took from a world whose regions
 * never move.
 *
 * No kicker above the heading. The heading carries its own weight.
 */
export function ScreenHeader({
  title,
  note,
  actions,
  aside,
}: {
  title: string;
  /** The screen's standing explanation. Product truth — never trimmed for tidiness. */
  note?: ReactNode;
  actions?: ReactNode;
  /** A figure the screen is read against, e.g. the cutover date. */
  aside?: ReactNode;
}) {
  return (
    <header className="mb-6">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold leading-tight tracking-tight text-ink">{title}</h1>
          {note ? (
            <p className="mt-1 max-w-[68ch] text-sm leading-relaxed text-ink-3">{note}</p>
          ) : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
      {aside ? <div className="mt-3">{aside}</div> : null}
    </header>
  );
}
