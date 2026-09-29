import type { Role } from "@ceedo/shared";
import { RESOURCES } from "../admin/resource";
import "../admin/registry";
import type { NavSection, NavTab } from "./match";

export { activeModule, isWithin } from "./match";
export type { NavModule, NavSection, NavTab } from "./match";

/**
 * The sidebar is organised by the office's jobs, not by table. Each rail item is a module;
 * each module's screens are tabs across the top of the field. Every screen keeps its own
 * URL, so a module is only a grouping over routes that already exist.
 *
 * A tab names either a registry resource (its title and read roles come from the registry,
 * so the rail can never offer a role a screen RLS will render empty) or a fixed screen that
 * every web role may read.
 */
type TabSpec = { resource: string } | { href: string; label: string };

interface ModuleSpec {
  key: string;
  label: string;
  tabs: TabSpec[];
  /** Routes that belong to the module without being a tab of it, e.g. a drill-in. */
  also?: string[];
}

const SECTIONS: { heading: string; modules: ModuleSpec[] }[] = [
  {
    heading: "Daily work",
    modules: [
      { key: "dashboard", label: "Dashboard", tabs: [{ href: "/", label: "Dashboard" }] },
      {
        key: "collections",
        label: "Collections",
        tabs: [
          { href: "/ledger/collections", label: "Receipts" },
          { href: "/ledger/shifts", label: "Shifts" },
          { href: "/ledger/remittances", label: "Remittances" },
          { href: "/ledger/exceptions", label: "Exceptions" },
        ],
      },
      {
        key: "receivables",
        label: "Receivables",
        tabs: [
          { href: "/ledger/aging", label: "Aging" },
          { href: "/ledger/delinquency", label: "Delinquency" },
          { href: "/ledger/opening-balances", label: "Opening balances" },
        ],
        // The subsidiary ledger is reached by drilling in from Aging or Delinquency.
        also: ["/ledger/leases"],
      },
      { key: "reports", label: "Reports", tabs: [{ href: "/reports", label: "Reports" }] },
    ],
  },
  {
    heading: "Records",
    modules: [
      {
        key: "tenants",
        label: "Tenants",
        tabs: [
          { resource: "tenants" },
          { resource: "leases" },
          { href: "/cards", label: "Tenant cards" },
        ],
      },
      {
        key: "market",
        label: "Market",
        tabs: [{ resource: "stalls" }, { resource: "sections" }, { resource: "facilities" }],
      },
      { key: "fees", label: "Fees", tabs: [{ resource: "fee-types" }, { resource: "rates" }] },
      {
        key: "forms",
        label: "Accountable forms",
        tabs: [
          { resource: "booklets" },
          { resource: "booklet-assignments" },
          { resource: "form-types" },
        ],
      },
      {
        key: "tablets",
        label: "Tablets",
        tabs: [
          { resource: "devices" },
          { resource: "collector-assignments" },
        ],
      },
      {
        key: "staff",
        label: "Staff",
        tabs: [{ resource: "users" }, { resource: "staff-invites" }, { resource: "audit-log" }],
      },
    ],
  },
];

/**
 * Only for an administrator on the database's super-admin allowlist (migration 0052). The
 * allowlist is not a role, so the layout asks the database and passes the answer in.
 */
const SUPER_ADMIN_SECTION: NavSection = {
  heading: "System",
  modules: [
    {
      key: "super-admin",
      label: "Super admin",
      href: "/super-admin",
      tabs: [{ href: "/super-admin", label: "Test data" }],
      also: [],
    },
  ],
};

/** The resource keys the module map files somewhere; exported for the test that keeps it whole. */
export const RESOURCE_TABS = SECTIONS.flatMap((section) =>
  section.modules.flatMap((mod) =>
    mod.tabs.flatMap((tab) => ("resource" in tab ? [tab.resource] : [])),
  ),
);

/**
 * The rail for one role. A tab over a resource the role cannot read is dropped, and a
 * module left with no tabs is dropped with it. Navigation, not access control: RLS denies.
 */
export function navFor(role: Role, options: { superAdmin?: boolean } = {}): NavSection[] {
  const sections = SECTIONS.map((section) => ({
    heading: section.heading,
    modules: section.modules.flatMap((mod) => {
      const tabs = mod.tabs.flatMap((tab): NavTab[] => {
        if (!("resource" in tab)) return [tab];
        const config = RESOURCES[tab.resource];
        return config && config.readRoles.includes(role)
          ? [{ href: `/${config.key}`, label: config.title }]
          : [];
      });
      const first = tabs[0];
      return first ? [{ key: mod.key, label: mod.label, href: first.href, tabs, also: mod.also ?? [] }] : [];
    }),
  })).filter((section) => section.modules.length > 0);
  return options.superAdmin ? [...sections, SUPER_ADMIN_SECTION] : sections;
}
