"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Menu, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { cn } from "@/components/ui/cn";

export interface NavGroup {
  heading: string;
  items: { href: string; label: string }[];
}

/**
 * The chassis: the enamelled body of the machine the tape runs out of.
 *
 * Dark because it is the machine, not because it is a theme — there is one theme, and the
 * field it holds is pale paper (see globals.css). Nav items resolve to 7:1 against the
 * chassis at rest, which is the part dark sidebars usually get wrong.
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

  const nav = (
    <nav className="flex h-full min-h-0 flex-col" aria-label="Sections">
      <div className="border-b border-chassis-700 px-4 py-4">
        <Link href="/" className="on-chassis block rounded-[2px]">
          <span className="block text-lg font-semibold leading-none tracking-[0.02em] text-chassis-ink">
            CEEDO
          </span>
          <span className="caption mt-1.5 block text-chassis-dim">Collections</span>
        </Link>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-4">
        {groups.map((group, index) => (
          <div key={group.heading} className={cn(index > 0 && "mt-6")}>
            <p className="caption px-2 pb-1.5 text-chassis-dim/75">{group.heading}</p>
            <ul>
              {group.items.map((item) => {
                const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
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
                        "on-chassis relative block rounded-[2px] py-[7px] pl-3.5 pr-2 text-sm",
                        "transition-colors duration-150",
                        active
                          ? "bg-chassis-700 font-medium text-chassis-ink"
                          : "text-chassis-dim hover:bg-chassis-800 hover:text-chassis-ink",
                      )}
                    >
                      {/* The selected item carries an ink bar, not only a tint: the
                          current screen is identifiable with colour removed. */}
                      <span
                        aria-hidden
                        className={cn(
                          "absolute left-0 top-1/2 h-[1.125rem] w-[3px] -translate-y-1/2 rounded-r-[1px]",
                          active ? "bg-chassis-accent" : "bg-transparent",
                        )}
                      />
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>

      <div className="border-t border-chassis-700 px-4 py-3">
        <p className="truncate text-xs font-medium text-chassis-ink">{staffName}</p>
        <p className="caption mt-1 text-chassis-dim/75">{staffRole}</p>
      </div>
    </nav>
  );

  return (
    <>
      {/* Desktop: the rail is part of the frame and never moves between routes. */}
      <div className="on-chassis hidden w-60 shrink-0 bg-chassis-900 lg:block">
        <div className="sticky top-0 h-dvh">{nav}</div>
      </div>

      {/* Phone and tablet: the same chassis, pulled out when asked for. */}
      <div className="on-chassis sticky top-0 z-40 flex items-center gap-3 bg-chassis-900 px-3 py-2 lg:hidden">
        <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
          <DialogPrimitive.Trigger
            aria-label="Open the section list"
            className="rounded-[2px] p-1.5 text-chassis-dim transition-colors duration-150 hover:bg-chassis-700 hover:text-chassis-ink"
          >
            <Menu size={18} strokeWidth={1.75} />
          </DialogPrimitive.Trigger>
          <DialogPrimitive.Portal>
            <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-chassis-900/60 data-[state=open]:animate-[fade-in_150ms_ease-out]" />
            <DialogPrimitive.Content
              className={cn(
                "on-chassis fixed inset-y-0 left-0 z-50 w-64 bg-chassis-900",
                "data-[state=open]:animate-[rail-in_190ms_cubic-bezier(0.16,1,0.3,1)]",
              )}
            >
              <DialogPrimitive.Title className="sr-only">Sections</DialogPrimitive.Title>
              <DialogPrimitive.Close
                aria-label="Close the section list"
                className="absolute right-2 top-3 rounded-[2px] p-1.5 text-chassis-dim transition-colors duration-150 hover:bg-chassis-700 hover:text-chassis-ink"
              >
                <X size={16} strokeWidth={1.75} />
              </DialogPrimitive.Close>
              {nav}
            </DialogPrimitive.Content>
          </DialogPrimitive.Portal>
        </DialogPrimitive.Root>
        <span className="text-sm font-semibold tracking-[0.02em] text-chassis-ink">CEEDO</span>
        <span className="caption ml-auto truncate text-chassis-dim/75">{staffRole}</span>
      </div>
    </>
  );
}
