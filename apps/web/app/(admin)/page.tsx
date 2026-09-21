import { ScreenHeader } from "@/components/shell/screen-header";
import { requireStaff } from "@/lib/supabase/session";

export default async function HomePage() {
  const staff = await requireStaff();
  return (
    // No nested <main>: the admin layout already provides one, and the previous version of
    // this page opened a second inside it.
    <ScreenHeader
      title="CEEDO Collections"
      note={`Signed in as ${staff.fullName} (${staff.role}).`}
    />
  );
}
