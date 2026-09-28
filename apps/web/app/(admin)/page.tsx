import type { ReactNode } from "react";
import Link from "next/link";
import { format, type Centavos } from "@ceedo/shared";
import { ScreenHeader } from "@/components/shell/screen-header";
import { cn } from "@/components/ui/cn";
import { Mark, QuietMark } from "@/components/ui/mark";
import { Notice } from "@/components/ui/panel";
import { getDashboard, type Loaded } from "@/lib/dashboard/queries";
import { longDate } from "@/lib/reports/params";
import { requireStaff } from "@/lib/supabase/session";

/**
 * The first screen after sign-in: one figure per question the office asks each day, each
 * linking to the screen that answers it in full. Nothing here is actionable in place; the
 * dashboard says where to look, and the screen it links to is where the work is done.
 *
 * Principle 1 of PRODUCT.md governs the order: what needs chasing (a tablet that never
 * closed, cash not banked, an exception past three days) carries a mark with its own word,
 * and the figures stay achromatic.
 */
export default async function HomePage() {
  const staff = await requireStaff();
  const d = await getDashboard();

  return (
    <div>
      <ScreenHeader
        title="Dashboard"
        note={`${longDate(d.today)}. Signed in as ${staff.fullName} (${staff.role}).`}
      />

      {d.opening.ok && d.opening.value > 0 ? (
        <Notice tone="warning" className="mb-6">
          {d.opening.value} active {d.opening.value === 1 ? "lease has" : "leases have"} no
          opening balance recorded yet, so aging and delinquency understate what is owed.{" "}
          <Link href="/ledger/opening-balances" className="font-medium underline underline-offset-2">
            Record opening balances
          </Link>
        </Notice>
      ) : null}

      <Band title="Today">
        <Tile label="Collected today" href={`/ledger/collections?businessDate=${d.today}`} data={d.collected}>
          {(c) => ({
            figure: <Figure amount={c.gross} />,
            detail: `${plural(c.receipts, "receipt")}${c.voided ? `, ${c.voided} voided` : ""}`,
          })}
        </Tile>

        <Tile label="Shifts" href="/ledger/shifts" data={d.shifts}>
          {(s) => ({
            figure: plural(s.open, "tablet") + " out",
            detail: "Open shifts dated today",
            marks: [
              s.staleOpen ? <Mark key="stale" tone="alert">{s.staleOpen} never closed</Mark> : null,
              s.unsynced ? <Mark key="unsynced" tone="warn">{s.unsynced} not synced</Mark> : null,
              s.varianceCount ? <Mark key="variance" tone="warn">{s.varianceCount} with variance</Mark> : null,
            ],
            alert: s.staleOpen > 0,
          })}
        </Tile>

        <Tile label="Cash awaiting deposit" href="/ledger/remittances" data={d.deposit}>
          {(p) => ({
            figure: <Figure amount={p.declared} />,
            detail: p.shifts
              ? `${plural(p.shifts, "closed shift")} not yet banked`
              : "Every closed shift is covered by a deposit",
            marks: [
              p.oldestDate && p.oldestDate < d.today ? (
                <Mark key="oldest" tone="warn">Since {longDate(p.oldestDate)}</Mark>
              ) : null,
            ],
          })}
        </Tile>

        <Tile label="Deposits to verify" href="/ledger/remittances" data={d.verification}>
          {(v) => ({
            figure: plural(v.slips, "slip"),
            detail: v.slips ? `${format(v.amount)} recorded, not yet verified` : "Nothing waiting on accounting",
          })}
        </Tile>
      </Band>

      <Band title="Receivables">
        <Tile label="Outstanding" href="/ledger/aging" data={d.aging}>
          {(a) => ({
            figure: <Figure amount={a.outstanding} />,
            detail: `Owed across ${plural(a.leases, "lease")}`,
          })}
        </Tile>

        <Tile label="Over 90 days" href="/ledger/aging" data={d.aging}>
          {(a) => ({
            figure: <Figure amount={a.overNinety} />,
            detail: a.outstanding
              ? `${Math.round((a.overNinety / a.outstanding) * 100)}% of everything outstanding`
              : "Nothing outstanding",
          })}
        </Tile>

        <Tile label="Delinquent leases" href="/ledger/delinquency" data={d.delinquency}>
          {(l) => ({
            figure: String(l.leases),
            detail: l.leases ? `Longest overdue: ${plural(l.worstDaysOverdue, "day")}` : "No lease is overdue",
          })}
        </Tile>

        <Tile label="Open exceptions" href="/ledger/exceptions" data={d.exceptions}>
          {(e) => ({
            figure: String(e.open),
            detail: e.open ? "Rejected tablet entries to resolve" : "No rejected entries",
            marks: [
              e.overThreeDays ? (
                <Mark key="late" tone="alert">{e.overThreeDays} past 3 days</Mark>
              ) : null,
            ],
            alert: e.overThreeDays > 0,
          })}
        </Tile>
      </Band>
    </div>
  );
}

function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

/** Zero is an em dash, as everywhere money is shown: "₱0.00" hides the figures that matter. */
function Figure({ amount }: { amount: Centavos }) {
  return <>{amount === 0 ? "—" : format(amount)}</>;
}

function Band({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-6">
      <h2 className="caption mb-2 text-ink-2">{title}</h2>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{children}</div>
    </section>
  );
}

interface TileBody {
  figure: ReactNode;
  detail: string;
  marks?: ReactNode[];
  /** Needs chasing now: carries the ribbon edge, alongside a mark that says why. */
  alert?: boolean;
}

/**
 * One framed block per figure, the whole block a link to the screen behind it. An
 * unreadable figure says so in words; it never falls back to a zero.
 */
function Tile<T>({
  label,
  href,
  data,
  children,
}: {
  label: string;
  href: string;
  data: Loaded<T>;
  children: (value: T) => TileBody;
}) {
  const body = data.ok ? children(data.value) : null;
  const marks = body?.marks?.filter(Boolean) ?? [];

  return (
    <Link
      href={href}
      className={cn(
        "flex flex-col rounded-xl sm:min-h-32 border border-rule bg-tape-raised px-4 py-3.5",
        "transition-colors duration-150 hover:border-rule-strong hover:bg-tape-hover",
        body?.alert && "border-l-4 border-l-ribbon",
      )}
    >
      <span className="caption text-ink-2">{label}</span>
      {body ? (
        <>
          <span className="mt-1.5 text-2xl font-semibold leading-tight tracking-tight text-ink tabular-nums">
            {body.figure}
          </span>
          <span className="mt-1 text-xs text-ink-2">{body.detail}</span>
          {marks.length ? <span className="mt-auto flex flex-wrap gap-1.5 pt-3">{marks}</span> : null}
        </>
      ) : (
        <span className="mt-auto pt-3">
          <Mark tone="warn">Could not be loaded</Mark>{" "}
          <QuietMark>You may not have access to this figure.</QuietMark>
        </span>
      )}
    </Link>
  );
}
