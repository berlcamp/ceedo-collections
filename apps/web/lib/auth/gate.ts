import { canUseWeb, type Role } from "@ceedo/shared";

export interface AccessDecision {
  allowed: boolean;
  reason: "ok" | "not_signed_in" | "not_registered" | "role_not_permitted";
}

export interface Membership {
  role: Role;
  status: string;
}

/**
 * Authentication establishes identity; membership establishes access.
 *
 * `auth.users` is shared with unrelated systems on this Supabase project, so a
 * valid session proves only that someone signed in somewhere — never that they
 * belong here. Access is granted by an administrator creating the `app_users`
 * row in advance.
 */
export function decideAccess(
  session: { userId: string } | null,
  member: Membership | null,
): AccessDecision {
  if (!session) return { allowed: false, reason: "not_signed_in" };
  if (!member || member.status !== "active") {
    return { allowed: false, reason: "not_registered" };
  }
  if (!canUseWeb(member.role)) return { allowed: false, reason: "role_not_permitted" };
  return { allowed: true, reason: "ok" };
}
