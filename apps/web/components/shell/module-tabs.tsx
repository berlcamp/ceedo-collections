"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/components/ui/cn";
import { activeModule, isWithin, type NavSection } from "@/lib/nav/match";

/**
 * The current module's screens, as tabs above the header band.
 *
 * Rendered by the layout rather than by each page, so a screen does not need to know which
 * module it was filed under. A module with one screen (Dashboard, Reports) shows no strip:
 * a single tab is only a second heading. A drill-in that is not itself a tab (the
 * subsidiary ledger under Receivables) shows the strip with no tab current.
 *
 * The current tab is set in medium weight over a 2px navy rule, so it reads with colour
 * removed, the same way the rail's current item does.
 */
export function ModuleTabs({ sections }: { sections: NavSection[] }) {
  const pathname = usePathname();
  const mod = activeModule(pathname, sections);
  if (!mod || mod.tabs.length < 2) return null;

  return (
    <nav aria-label={mod.label} className="-mt-1 mb-6 border-b border-rule print:hidden">
      <ul className="-mb-px flex gap-1 overflow-x-auto">
        {mod.tabs.map((tab) => {
          const current = isWithin(pathname, tab.href);
          return (
            <li key={tab.href} className="shrink-0">
              <Link
                href={tab.href}
                aria-current={current ? "page" : undefined}
                className={cn(
                  "flex h-9 items-center rounded-t-md border-b-2 px-3 text-sm whitespace-nowrap",
                  "transition-colors duration-150",
                  current
                    ? "border-mark font-medium text-ink"
                    : "border-transparent text-ink-2 hover:border-rule-strong hover:text-ink",
                )}
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
