"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Landmark, LogOut, Menu, PanelLeftClose, PanelLeftOpen, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { NAV_ICONS } from "@/components/shell/nav-icons";
import { cn } from "@/components/ui/cn";
import { Tooltip } from "@/components/ui/tooltip";
import { RAIL_COOKIE, RAIL_COOKIE_MAX_AGE } from "@/components/shell/rail-cookie";
import { signOut } from "@/lib/auth/actions";
import { activeModule, type NavSection } from "@/lib/nav/match";

/**
 * The chassis: the navy panel the pale field of figures sits beside.
 *
 * Dark because it is the machine, not because it is a theme — there is one theme, and the
 * field it holds is the off-white page (see globals.css). The treatment follows CEEDO's
 * sibling app, berlcamp/hris, so the two read as the same office: 16rem wide, no right
 * border (the value step between navy and off-white is the separation), 10px uppercase
 * group headings at 40%, flush 32px nav rows, and brass spent in exactly two places —
 * the brand tile and the user chip.
 *
 * Nav text rests at chassis-dim, about 12:1 on the rail, which is the part dark sidebars
 * usually get wrong.
 */
export function ChassisRail({
  sections,
  staffName,
  staffRole,
  defaultCollapsed = false,
}: {
  /** From `navFor()`. Each module's `key` names its entry in NAV_ICONS: a component cannot
   * cross the RSC boundary. */
  sections: NavSection[];
  staffName: string;
  staffRole: string;
  /** From the rail cookie, read server-side. */
  defaultCollapsed?: boolean;
}) {
  const pathname = usePathname();
  // One module is current across all of its tabs, so /stalls and /sections both light Market.
  const current = activeModule(pathname, sections);
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  const toggle = useCallback(() => {
    setCollapsed((was) => {
      const next = !was;
      document.cookie = `${RAIL_COOKIE}=${next ? "1" : "0"}; path=/; max-age=${RAIL_COOKIE_MAX_AGE}; samesite=lax`;
      return next;
    });
  }, []);

  // Ctrl+B / Cmd+B, the shortcut the office's other system (ccb-sms) uses for the same rail.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key.toLowerCase() === "b" && (event.metaKey || event.ctrlKey) && !event.altKey) {
        event.preventDefault();
        toggle();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [toggle]);

  const initials = staffName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");

  const toggleButton = (
    <Tooltip
      label={collapsed ? "Expand sidebar (Ctrl+B)" : "Collapse sidebar (Ctrl+B)"}
      side="right"
    >
      <button
        type="button"
        onClick={toggle}
        aria-label={collapsed ? "Expand the sidebar" : "Collapse the sidebar"}
        aria-expanded={!collapsed}
        className="on-chassis rounded-md p-1.5 text-chassis-dim/60 transition-colors duration-150 hover:bg-chassis-700 hover:text-chassis-ink"
      >
        {collapsed ? (
          <PanelLeftOpen size={16} strokeWidth={1.75} />
        ) : (
          <PanelLeftClose size={16} strokeWidth={1.75} />
        )}
      </button>
    </Tooltip>
  );

  /**
   * `compact` is the collapsed desktop rail: icons only, each label moved into a tooltip
   * and kept for screen readers. The phone sheet always renders the full rail.
   */
  const renderNav = (compact: boolean, withToggle: boolean) => (
    <nav className="flex h-full min-h-0 flex-col" aria-label="Sections">
      {compact ? (
        <div className="flex h-14 shrink-0 items-center justify-center">{toggleButton}</div>
      ) : (
        <div className="flex h-14 shrink-0 items-center gap-2 px-4">
          <Link href="/" className="on-chassis flex min-w-0 items-center gap-3 rounded-md">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-chassis-accent text-chassis-900">
              <Landmark size={18} strokeWidth={1.75} />
            </span>
            <span className="flex flex-col">
              <span className="text-sm font-bold tracking-tight text-chassis-dim">CEEDO</span>
              <span className="text-2xs font-medium uppercase tracking-[0.12em] text-chassis-dim/50">
                Collections
              </span>
            </span>
          </Link>
          {withToggle ? <div className="ml-auto">{toggleButton}</div> : null}
        </div>
      )}
      <div className="h-px shrink-0 bg-chassis-600" />

      <div className="min-h-0 flex-1 overflow-y-auto px-1 pt-2 pb-4">
        {sections.map((group, index) => (
          <div key={group.heading} className={cn("p-2", index > 0 && (compact ? "pt-2" : "pt-4"))}>
            {compact ? (
              // Headings do not fit a 3.5rem rail; a rule keeps the groups apart.
              index > 0 ? (
                <div className="mx-1 mb-2 h-px bg-chassis-600" />
              ) : null
            ) : (
              <p className="mb-1 px-2 text-2xs font-semibold uppercase tracking-[0.12em] text-chassis-dim/40">
                {group.heading}
              </p>
            )}
            <ul className="flex flex-col">
              {group.modules.map((item) => {
                const active = item.key === current?.key;
                const Icon = NAV_ICONS[item.key];
                return (
                  <li key={item.key}>
                    <Tooltip label={item.label} side="right" disabled={!compact}>
                      <Link
                        href={item.href}
                        // Closes the phone sheet on the way out. Done here rather than in an
                        // effect on the pathname: the tap is the event, and a route that
                        // resolves to the screen already open should still dismiss it.
                        onClick={() => setOpen(false)}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          "on-chassis flex h-8 items-center gap-2 overflow-hidden rounded-md p-2 text-sm",
                          compact && "justify-center",
                          "transition-colors duration-150",
                          // Hover and current share a ground; weight is what separates them,
                          // so the current screen is identifiable with colour removed.
                          active
                            ? "bg-chassis-700 font-medium text-chassis-ink"
                            : "text-chassis-dim hover:bg-chassis-700 hover:text-chassis-ink",
                        )}
                      >
                        {Icon ? <Icon size={16} strokeWidth={1.75} className="shrink-0" /> : null}
                        <span className={compact ? "sr-only" : "truncate"}>{item.label}</span>
                      </Link>
                    </Tooltip>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>

      <div className={cn("shrink-0", compact ? "px-2 py-3" : "p-3")}>
        <div className="mx-1 mb-3 h-px bg-chassis-600" />
        <div
          className={cn("flex items-center gap-2", compact ? "flex-col justify-center" : "px-1")}
        >
          <Tooltip label={`${staffName} · ${staffRole}`} side="right" disabled={!compact}>
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-chassis-accent text-2xs font-bold text-chassis-900">
              {initials}
            </span>
          </Tooltip>
          <span className={cn("flex min-w-0 flex-col", compact && "sr-only")}>
            <span className="truncate text-xs font-semibold text-chassis-dim">{staffName}</span>
            <span className="truncate text-2xs uppercase tracking-[0.12em] text-chassis-dim/50">
              {staffRole}
            </span>
          </span>
          <form action={signOut} className={compact ? undefined : "ml-auto"}>
            <Tooltip label="Sign out" side="right">
              <button
                type="submit"
                aria-label="Sign out"
                className="on-chassis rounded-md p-1.5 text-chassis-dim/60 transition-colors duration-150 hover:bg-chassis-700 hover:text-chassis-ink"
              >
                <LogOut size={16} strokeWidth={1.75} />
              </button>
            </Tooltip>
          </form>
        </div>
      </div>
    </nav>
  );

  return (
    <>
      {/* Desktop: the rail is part of the frame and never moves between routes. No right
          border — the value step between the navy and the field is the separation. */}
      <div
        className={cn(
          "on-chassis hidden shrink-0 bg-chassis-900 transition-[width] duration-200 ease-out motion-reduce:transition-none lg:block",
          collapsed ? "w-14" : "w-64",
        )}
      >
        <div className="sticky top-0 h-dvh">{renderNav(collapsed, true)}</div>
      </div>

      {/* Phone and tablet: the same chassis, pulled out when asked for. */}
      <div className="on-chassis sticky top-0 z-40 flex h-14 items-center gap-3 bg-chassis-900 px-3 lg:hidden">
        <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
          <DialogPrimitive.Trigger
            aria-label="Open the section list"
            className="rounded-md p-1.5 text-chassis-dim transition-colors duration-150 hover:bg-chassis-700 hover:text-chassis-ink"
          >
            <Menu size={18} strokeWidth={1.75} />
          </DialogPrimitive.Trigger>
          <DialogPrimitive.Portal>
            <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-chassis-900/60 data-[state=open]:animate-[fade-in_150ms_ease-out]" />
            <DialogPrimitive.Content
              className={cn(
                "on-chassis fixed inset-y-0 left-0 z-50 w-72 bg-chassis-900",
                "data-[state=open]:animate-[rail-in_190ms_cubic-bezier(0.16,1,0.3,1)]",
              )}
            >
              <DialogPrimitive.Title className="sr-only">Sections</DialogPrimitive.Title>
              <DialogPrimitive.Close
                aria-label="Close the section list"
                className="absolute right-2 top-4 rounded-md p-1.5 text-chassis-dim transition-colors duration-150 hover:bg-chassis-700 hover:text-chassis-ink"
              >
                <X size={16} strokeWidth={1.75} />
              </DialogPrimitive.Close>
              {renderNav(false, false)}
            </DialogPrimitive.Content>
          </DialogPrimitive.Portal>
        </DialogPrimitive.Root>
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-chassis-accent text-chassis-900">
          <Landmark size={15} strokeWidth={1.75} />
        </span>
        <span className="text-sm font-bold tracking-tight text-chassis-dim">CEEDO</span>
        <span className="ml-auto truncate text-2xs font-medium uppercase tracking-[0.12em] text-chassis-dim/50">
          {staffRole}
        </span>
      </div>
    </>
  );
}
