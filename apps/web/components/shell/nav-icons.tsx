import {
  BookMarked,
  FileSpreadsheet,
  Hourglass,
  LayoutDashboard,
  Receipt,
  Store,
  Tablet,
  Tags,
  UserCog,
  Users,
  type LucideIcon,
} from "lucide-react";

/**
 * Rail icons, one per module (`lib/nav/modules.ts`), resolved by name rather than passed as
 * components.
 *
 * The rail's nav data is assembled in a Server Component, and a React component cannot
 * cross that boundary — so the layout sends a module key and this map turns it back into a
 * glyph on the client. One library, one 16px size, one stroke.
 */
export const NAV_ICONS: Record<string, LucideIcon> = {
  dashboard: LayoutDashboard,
  collections: Receipt,
  receivables: Hourglass,
  reports: FileSpreadsheet,
  tenants: Users,
  market: Store,
  fees: Tags,
  forms: BookMarked,
  tablets: Tablet,
  staff: UserCog,
};
