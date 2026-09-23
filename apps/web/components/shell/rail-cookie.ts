/**
 * The collapsed-rail cookie. A plain module, not part of chassis-rail.tsx: that file is
 * "use client", and a constant exported from it reaches a Server Component as a client
 * reference rather than as this string.
 *
 * Read by the admin layout on the server, so a collapsed rail renders collapsed at once
 * instead of flashing open and then snapping shut.
 */
export const RAIL_COOKIE = "rail_collapsed";
export const RAIL_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
