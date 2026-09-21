"use client";

import * as PopoverPrimitive from "@radix-ui/react-popover";
import type { ReactNode } from "react";
import { cn } from "./cn";

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverAnchor = PopoverPrimitive.Anchor;

export function PopoverContent({
  children,
  align = "start",
  className,
}: {
  children: ReactNode;
  align?: "start" | "center" | "end";
  className?: string;
}) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        align={align}
        sideOffset={5}
        collisionPadding={12}
        className={cn(
          "z-50 rounded-[2px] border border-rule-strong bg-tape-raised",
          "shadow-[0_12px_32px_-12px_rgba(22,21,15,0.38)]",
          "data-[state=open]:animate-[fade-in_130ms_ease-out]",
          className,
        )}
      >
        {children}
      </PopoverPrimitive.Content>
    </PopoverPrimitive.Portal>
  );
}
