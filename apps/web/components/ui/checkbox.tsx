"use client";

import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { Check } from "lucide-react";
import { cn } from "./cn";

/**
 * The tick a clerk puts in a form's box. Square, ink-filled when set — the checked state
 * is legible with colour removed, which is the rule this world holds itself to.
 */
export function Checkbox({
  id,
  name,
  checked,
  onCheckedChange,
  disabled,
  className,
}: {
  id?: string;
  name?: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <CheckboxPrimitive.Root
      id={id}
      name={name}
      checked={checked}
      onCheckedChange={(next) => onCheckedChange(next === true)}
      disabled={disabled}
      className={cn(
        "flex h-[17px] w-[17px] shrink-0 items-center justify-center rounded-[2px] border",
        "border-rule-strong bg-tape-sunk transition-colors duration-150",
        "hover:border-ink-3",
        "data-[state=checked]:border-chassis-900 data-[state=checked]:bg-chassis-900",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
    >
      <CheckboxPrimitive.Indicator className="text-tape-raised">
        <Check size={12} strokeWidth={2.75} />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}
