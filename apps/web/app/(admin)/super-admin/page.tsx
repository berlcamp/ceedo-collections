import { isAdmin } from "@ceedo/shared";
import { notFound } from "next/navigation";
import { ScreenHeader } from "@/components/shell/screen-header";
import { ClearDataPanel, SeedDataPanel } from "@/components/super-admin/super-admin-panels";
import { getServerClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/supabase/session";

export default async function SuperAdminPage() {
  const staff = await requireStaff();
  if (!isAdmin(staff.role)) notFound();
  const supabase = await getServerClient();
  const { data: superAdmin } = await supabase.rpc("is_super_admin");
  // Not found, not "forbidden": an admin off the allowlist has no reason to know it exists.
  if (!superAdmin) notFound();

  return (
    <div>
      <ScreenHeader
        title="Super admin"
        note="Tools for testing the web and the tablets. They act on whichever database this site is connected to, production included."
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <SeedDataPanel />
        <ClearDataPanel />
      </div>
    </div>
  );
}
