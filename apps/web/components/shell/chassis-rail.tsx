"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Landmark, Menu, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { NAV_ICONS } from "@/components/shell/nav-icons";
import { cn } from "@/components/ui/cn";

export interface NavGroup {
  heading: string;
  /** `icon` names an entry in NAV_ICONS; a component cannot cross the RSC boundary. */
  items: { href: string; label: string; icon: string }[];
}

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
  groups,
  staffName,
  staffRole,
}: {
  groups: NavGroup[];
  staffName: string;
  staffRole: string;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const initials = staffName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");

  const nav = (
    <nav className="flex h-full min-h-0 flex-col" aria-label="Sections">
      <div className="flex h-14 shrink-0 items-center px-4">
        <Link href="/" className="on-chassis flex items-center gap-3 rounded-md">
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
      </div>
      <div className="h-px shrink-0 bg-chassis-600" />

      <div className="min-h-0 flex-1 overflow-y-auto px-1 pt-2 pb-4">
        {groups.map((group, index) => (
          <div key={group.heading} className={cn("p-2", index > 0 && "pt-4")}>
            <p className="mb-1 px-2 text-2xs font-semibold uppercase tracking-[0.12em] text-chassis-dim/40">
              {group.heading}
            </p>
            <ul className="flex flex-col">
              {group.items.map((item) => {
                const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                const Icon = NAV_ICONS[item.icon];
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      // Closes the phone sheet on the way out. Done here rather than in an
                      // effect on the pathname: the tap is the event, and a route that
                      // resolves to the screen already open should still dismiss it.
                      onClick={() => setOpen(false)}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "on-chassis flex h-8 items-center gap-2 overflow-hidden rounded-md p-2 text-sm",
                        "transition-colors duration-150",
                        // Hover and current share a ground; weight is what separates them,
                        // so the current screen is identifiable with colour removed.
                        active
                          ? "bg-chassis-700 font-medium text-chassis-ink"
                          : "text-chassis-dim hover:bg-chassis-700 hover:text-chassis-ink",
                      )}
                    >
                      {Icon ? <Icon size={16} strokeWidth={1.75} className="shrink-0" /> : null}
                      <span className="truncate">{item.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>

      <div className="shrink-0 p-3">
        <div className="mx-1 mb-3 h-px bg-chassis-600" />
        <div className="flex items-center gap-2 px-1">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-chassis-accent text-2xs font-bold text-chassis-900">
            {initials}
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-xs font-semibold text-chassis-dim">{staffName}</span>
            <span className="truncate text-2xs uppercase tracking-[0.12em] text-chassis-dim/50">
              {staffRole}
            </span>
          </span>
        </div>
      </div>
    </nav>
  );

  return (
    <>
      {/* Desktop: the rail is part of the frame and never moves between routes. No right
          border — the value step between the navy and the field is the separation. */}
      <div className="on-chassis hidden w-64 shrink-0 bg-chassis-900 lg:block">
        <div className="sticky top-0 h-dvh">{nav}</div>
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
              {nav}
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
