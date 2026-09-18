import Link from "next/link";
import { RESOURCES } from "@/lib/admin/resource";
import { requireStaff } from "@/lib/supabase/session";
import "@/lib/admin/registry";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const staff = await requireStaff();

  // Only the screens this role can actually see anything on. Listing every resource to
  // every role offered a supervisor a "Staff invitations" link that RLS guarantees will
  // render empty — indistinguishable, from the operator's side, from there being no
  // invitations. This is navigation, not access control: the policies are what deny.
  const visible = Object.values(RESOURCES).filter((resource) =>
    resource.readRoles.includes(staff.role),
  );

  return (
    <div className="flex min-h-dvh">
      <nav className="w-56 shrink-0 border-r border-neutral-200 px-4 py-6">
        <p className="mb-6 text-sm font-semibold">CEEDO Collections</p>
        <ul className="space-y-1">
          {visible.map((resource) => (
            <li key={resource.key}>
              <Link
                href={`/${resource.key}`}
                className="block rounded px-2 py-1.5 text-sm text-neutral-700 hover:bg-neutral-100"
              >
                {resource.title}
              </Link>
            </li>
          ))}
        </ul>
        {/*
          Ledger: read-plus-RPC screens over Task 14's reporting views, not master-data
          CRUD, so they live outside RESOURCES/the registry engine rather than being forced
          into a shape built for editing. No per-role filter is needed here the way
          `visible` filters resources above: every role that reaches this layout at all
          already cleared canUseWeb() in requireStaff(), and that is exactly the role set
          the views' own RLS policy admits (migration 20260918000011's
          apply_ledger_policies: supervisor, accounting, admin). The subsidiary ledger is
          reached by drilling in from Aging or Delinquency, not linked here directly.
        */}
        <p className="mt-8 mb-2 px-2 text-xs font-semibold uppercase text-neutral-400">
          Ledger
        </p>
        <ul className="space-y-1">
          <li>
            <Link
              href="/ledger/aging"
              className="block rounded px-2 py-1.5 text-sm text-neutral-700 hover:bg-neutral-100"
            >
              Aging of receivables
            </Link>
          </li>
          <li>
            <Link
              href="/ledger/delinquency"
              className="block rounded px-2 py-1.5 text-sm text-neutral-700 hover:bg-neutral-100"
            >
              Delinquency list
            </Link>
          </li>
          <li>
            <Link
              href="/ledger/collections"
              className="block rounded px-2 py-1.5 text-sm text-neutral-700 hover:bg-neutral-100"
            >
              Collections
            </Link>
          </li>
          <li>
            <Link
              href="/ledger/opening-balances"
              className="block rounded px-2 py-1.5 text-sm text-neutral-700 hover:bg-neutral-100"
            >
              Opening balances
            </Link>
          </li>
          {/* Unconditional, same as every other link in this section (see the comment
              above): migration 20260918000030 admits accounting to read sync_exceptions
              too, and exceptions are unresolved cash discrepancies with a §11.3 three-day
              Treasurer concern -- read-only oversight for accounting is desirable here, not
              merely tolerated. The page itself still gates the three resolution dialogs on
              canResolveExceptions, exactly as collections/page.tsx gates CancelDialog. */}
          <li>
            <Link
              href="/ledger/exceptions"
              className="block rounded px-2 py-1.5 text-sm text-neutral-700 hover:bg-neutral-100"
            >
              Exceptions
            </Link>
          </li>
        </ul>
        <p className="mt-8 text-xs text-neutral-500">
          {staff.fullName}
          <br />
          {staff.role}
        </p>
      </nav>
      <main className="flex-1 px-8 py-6">{children}</main>
    </div>
  );
}
