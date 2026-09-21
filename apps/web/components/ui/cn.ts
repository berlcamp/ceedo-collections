/** Joins class names. Small on purpose — this app has no need of a merge strategy. */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
