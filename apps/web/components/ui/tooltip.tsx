"use client";

import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import type { ReactNode } from "react";

export const TooltipProvider = TooltipPrimitive.Provider;

/** A pencilled marginal note — used only where a figure needs its provenance stated. */
export function Tooltip({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          sideOffset={5}
          collisionPadding={10}
          className="z-50 max-w-[18rem] rounded-md bg-chassis-900 px-2 py-1.5 text-xs leading-snug text-chassis-ink shadow-[0_8px_22px_-8px_rgba(12,18,26,0.5)] data-[state=delayed-open]:animate-[fade-in_120ms_ease-out]"
        >
          {label}
          <TooltipPrimitive.Arrow className="fill-chassis-900" width={9} height={4} />
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
