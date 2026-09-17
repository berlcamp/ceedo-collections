import { requireStaff } from "@/lib/supabase/session";

export default async function HomePage() {
  const staff = await requireStaff();
  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <h1 className="text-2xl font-semibold">CEEDO Collections</h1>
      <p className="mt-2 text-sm text-neutral-600">
        Signed in as {staff.fullName} ({staff.role}).
      </p>
    </main>
  );
}
