import type { ReactNode } from "react";
import { cn } from "./cn";

/**
 * A worksheet clipped to the tape: the shape every non-table block on this app uses, so a
 * credential panel, a PIN panel and the opening-balance form cannot drift apart.
 */
export function Panel({
  title,
  note,
  children,
  className,
}: {
  title: string;
  note?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("overflow-hidden rounded-xl border border-rule bg-tape-raised", className)}>
      <div className="border-b border-rule bg-tape px-4 py-2.5">
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        {note ? <div className="mt-1 text-xs leading-relaxed text-ink-2">{note}</div> : null}
      </div>
      <div className="px-4 py-3.5">{children}</div>
    </section>
  );
}

/** Notices. One shape, three tones, used for every result message in the app. */
export function Notice({
  tone,
  children,
  className,
}: {
  tone: "error" | "success" | "warning";
  children: ReactNode;
  className?: string;
}) {
  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "rounded-lg border px-3 py-2 text-xs leading-relaxed",
        tone === "error" && "border-ribbon/40 bg-ribbon-soft text-ribbon",
        tone === "success" && "border-proof/35 bg-proof-soft text-proof",
        tone === "warning" && "border-amber/40 bg-amber-soft text-amber",
        className,
      )}
    >
      {children}
    </p>
  );
}
