import { TooltipProvider } from "@radix-ui/react-tooltip";
import { cookies } from "next/headers";
import { ChassisRail } from "@/components/shell/chassis-rail";
import { ModuleTabs } from "@/components/shell/module-tabs";
import { RAIL_COOKIE } from "@/components/shell/rail-cookie";
import { isAdmin } from "@ceedo/shared";
import { navFor } from "@/lib/nav/modules";
import { getServerClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/supabase/session";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const staff = await requireStaff();
  const railCollapsed = (await cookies()).get(RAIL_COOKIE)?.value === "1";

  // The rail and the tabs over it, for this role only: a tab over a resource the role
  // cannot read is dropped (lib/nav/modules.ts), so nobody is offered a screen RLS will
  // render empty. Navigation, not access control: the policies are what deny.
  // The super-admin allowlist is asked of the database only for an admin, so every other
  // page load pays nothing for it.
  const superAdmin = isAdmin(staff.role)
    ? Boolean((await (await getServerClient()).rpc("is_super_admin")).data)
    : false;
  const sections = navFor(staff.role, { superAdmin });

  return (
    <TooltipProvider delayDuration={250}>
      <div className="flex min-h-dvh flex-col lg:flex-row">
        {/* Printing is only ever the tenant cards (/cards): the rail and the field's padding
            would otherwise land on the first sheet and push every card off its millimetres. */}
        <div className="contents print:hidden">
          <ChassisRail
            sections={sections}
            staffName={staff.fullName}
            staffRole={staff.role}
            defaultCollapsed={railCollapsed}
          />
        </div>
        <main className="min-w-0 flex-1 bg-tape px-4 py-6 sm:px-6 lg:px-8 lg:py-7 print:bg-white print:p-0">
          <div className="mx-auto max-w-[96rem] print:max-w-none">
            <ModuleTabs sections={sections} />
            {children}
          </div>
        </main>
      </div>
    </TooltipProvider>
  );
}
