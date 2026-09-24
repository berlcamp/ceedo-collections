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

  const readMember = async () =>
    userId
      ? (
          await supabase
            .from("app_users")
            .select("role, status, full_name")
            .eq("id", userId)
            .maybeSingle()
        ).data
      : null;

  let member = await readMember();

  // Signed in but not yet a member: claim a waiting invite. On a shared Supabase project an
  // invited person often ALREADY has an account (from the other system), so the auth.users
  // trigger that claims invites never fires for them (migration 0047). Only reached by
  // non-members, so a member's page load pays nothing for it.
  if (userId && !member) {
    const { data: claimed } = await supabase.rpc("claim_my_invite");
    if (claimed) member = await readMember();
  }

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
