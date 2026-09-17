export const ROLES = ["collector", "supervisor", "accounting", "admin"] as const;
export type Role = (typeof ROLES)[number];

/** Roles permitted to sign in to the web application. Collectors use the tablet only. */
export const WEB_ROLES: readonly Role[] = ["supervisor", "accounting", "admin"];

export function canUseWeb(role: Role): boolean {
  return WEB_ROLES.includes(role);
}

export function canManageMasterData(role: Role): boolean {
  return role === "admin";
}

export function canResolveExceptions(role: Role): boolean {
  return role === "supervisor" || role === "admin";
}

export function canVerifyRemittance(role: Role): boolean {
  return role === "accounting" || role === "admin";
}

export function canViewReports(role: Role): boolean {
  return role !== "collector";
}
