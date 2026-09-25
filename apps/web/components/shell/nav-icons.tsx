import {
  AlertTriangle,
  BookMarked,
  BookUser,
  Building2,
  CircleDollarSign,
  Clock,
  FileClock,
  FileSpreadsheet,
  FileSignature,
  Hourglass,
  Landmark,
  Banknote,
  Layers,
  Mail,
  MapPin,
  QrCode,
  Receipt,
  ScrollText,
  Store,
  Tablet,
  Tags,
  UserCog,
  Users,
  type LucideIcon,
} from "lucide-react";

/**
 * Nav icons, resolved by name rather than passed as components.
 *
 * The rail's nav data is assembled in a Server Component from the resource registry, and a
 * React component cannot cross that boundary — so the layout sends a string and this map
 * turns it back into a glyph on the client. One library, one 16px size, one stroke.
 */
export const NAV_ICONS: Record<string, LucideIcon> = {
  facilities: Building2,
  sections: Layers,
  stalls: Store,
  tenants: Users,
  leases: FileSignature,
  "fee-types": Tags,
  rates: CircleDollarSign,
  "form-types": ScrollText,
  booklets: BookMarked,
  "booklet-assignments": BookUser,
  devices: Tablet,
  "device-assignments": MapPin,
  "collector-assignments": MapPin,
  "staff-invites": Mail,
  users: UserCog,
  "audit-log": FileClock,
  aging: Hourglass,
  delinquency: AlertTriangle,
  collections: Receipt,
  "opening-balances": Landmark,
  exceptions: AlertTriangle,
  shifts: Clock,
  cards: QrCode,
  reports: FileSpreadsheet,
  remittances: Banknote,
};
