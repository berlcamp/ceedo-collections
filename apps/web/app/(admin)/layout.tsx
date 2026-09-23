import { TooltipProvider } from "@radix-ui/react-tooltip";
import { cookies } from "next/headers";
import { ChassisRail, type NavGroup } from "@/components/shell/chassis-rail";
import { RAIL_COOKIE } from "@/components/shell/rail-cookie";
import { RESOURCES } from "@/lib/admin/resource";
import { requireStaff } from "@/lib/supabase/session";
import "@/lib/admin/registry";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const staff = await requireStaff();
  const railCollapsed = (await cookies()).get(RAIL_COOKIE)?.value === "1";

  // Only the screens this role can actually see anything on. Listing every resource to
  // every role offered a supervisor a "Staff invitations" link that RLS guarantees will
  // render empty — indistinguishable, from the operator's side, from there being no
  // invitations. This is navigation, not access control: the policies are what deny.
  const visible = Object.values(RESOURCES).filter((resource) =>
    resource.readRoles.includes(staff.role),
  );

  /*
    Ledger: read-plus-RPC screens over Task 14's reporting views, not master-data
    CRUD, so they live outside RESOURCES/the registry engine rather than being forced
    into a shape built for editing. No per-role filter is needed here the way
    `visible` filters resources above: every role that reaches this layout at all
    already cleared canUseWeb() in requireStaff(), and that is exactly the role set
    the views' own RLS policy admits (migration 20260918000011's
    apply_ledger_policies: supervisor, accounting, admin). The subsidiary ledger is
    reached by drilling in from Aging or Delinquency, not linked here directly.

    Exceptions is unconditional for the same reason: migration 20260918000030 admits
    accounting to read sync_exceptions too, and exceptions are unresolved cash
    discrepancies with a §11.3 three-day Treasurer concern -- read-only oversight for
    accounting is desirable here, not merely tolerated. The page itself still gates the
    three resolution dialogs on canResolveExceptions, exactly as collections/page.tsx
    gates CancelDialog. Shifts likewise: migration 20260918000029 admits the same
    supervisor/accounting/admin set, and verification and remittance are Phase 6, so
    there is no action on it to gate.
  */
  const groups: NavGroup[] = [
    {
      heading: "Master data",
      items: visible.map((resource) => ({
        href: `/${resource.key}`,
        label: resource.title,
        icon: resource.key,
      })),
    },
    {
      heading: "Ledger",
      items: [
        { href: "/ledger/aging", label: "Aging of receivables", icon: "aging" },
        { href: "/ledger/delinquency", label: "Delinquency list", icon: "delinquency" },
        { href: "/ledger/collections", label: "Collections", icon: "collections" },
        { href: "/ledger/opening-balances", label: "Opening balances", icon: "opening-balances" },
        { href: "/ledger/exceptions", label: "Exceptions", icon: "exceptions" },
        { href: "/ledger/shifts", label: "Shifts", icon: "shifts" },
        { href: "/ledger/remittances", label: "Remittances", icon: "remittances" },
      ],
    },
    {
      heading: "Print",
      items: [
        { href: "/reports", label: "Reports", icon: "reports" },
        { href: "/cards", label: "Tenant cards", icon: "cards" },
      ],
    },
  ];

  return (
    <TooltipProvider delayDuration={250}>
      <div className="flex min-h-dvh flex-col lg:flex-row">
        {/* Printing is only ever the tenant cards (/cards): the rail and the field's padding
            would otherwise land on the first sheet and push every card off its millimetres. */}
        <div className="contents print:hidden">
          <ChassisRail
            groups={groups}
            staffName={staff.fullName}
            staffRole={staff.role}
            defaultCollapsed={railCollapsed}
          />
        </div>
        <main className="min-w-0 flex-1 bg-tape px-4 py-6 sm:px-6 lg:px-8 lg:py-7 print:bg-white print:p-0">
          <div className="mx-auto max-w-[96rem] print:max-w-none">{children}</div>
        </main>
      </div>
    </TooltipProvider>
  );
}
