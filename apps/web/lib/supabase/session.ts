import type { Role } from "@ceedo/shared";
import { redirect } from "next/navigation";
import { decideAccess } from "../auth/gate";
import { getServerClient } from "./server";

export interface StaffSession {
  userId: string;
  role: Role;
  fullName: string;
}

/** Resolves the caller, or redirects. Every authenticated page calls this first. */
export async function requireStaff(): Promise<StaffSession> {
  const supabase = await getServerClient();
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id ?? null;

  const { data: member } = userId
    ? await supabase
        .from("app_users")
        .select("role, status, full_name")
        .eq("id", userId)
        .maybeSingle()
    : { data: null };

  const decision = decideAccess(
    userId ? { userId } : null,
    member ? { role: member.role as Role, status: member.status } : null,
  );

  if (!decision.allowed) {
    redirect(decision.reason === "not_signed_in" ? "/sign-in" : "/no-access");
  }

  return {
    userId: userId!,
    role: member!.role as Role,
    fullName: member!.full_name,
  };
}
