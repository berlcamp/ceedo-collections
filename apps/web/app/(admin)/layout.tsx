import Link from "next/link";
import { RESOURCES } from "@/lib/admin/resource";
import { requireStaff } from "@/lib/supabase/session";
import "@/lib/admin/registry";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const staff = await requireStaff();

  return (
    <div className="flex min-h-dvh">
      <nav className="w-56 shrink-0 border-r border-neutral-200 px-4 py-6">
        <p className="mb-6 text-sm font-semibold">CEEDO Collections</p>
        <ul className="space-y-1">
          {Object.values(RESOURCES).map((resource) => (
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
