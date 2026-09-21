"use client";

import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "./cn";
import { controlClass } from "./field";

/**
 * Radix Select. Used wherever the value lives in React state — it gives typeahead,
 * full keyboard navigation and a listbox that escapes any scrolling ancestor, none of
 * which the native control offers consistently across the browsers this office runs.
 */
export function Select({
  value,
  onValueChange,
  placeholder = "Select…",
  options,
  id,
  name,
  invalid,
  disabled,
  className,
}: {
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  options: { value: string; label: string }[];
  id?: string;
  name?: string;
  invalid?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <SelectPrimitive.Root value={value} onValueChange={onValueChange} name={name} disabled={disabled}>
      <SelectPrimitive.Trigger
        id={id}
        className={cn(
          controlClass,
          "flex h-9 items-center justify-between gap-2 text-left",
          "data-[placeholder]:text-ink-3",
          invalid && "border-ribbon bg-ribbon-soft",
          className,
        )}
      >
        <SelectPrimitive.Value placeholder={placeholder} />
        <SelectPrimitive.Icon className="shrink-0 text-ink-3">
          <ChevronDown size={14} strokeWidth={1.75} />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>

      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={4}
          className={cn(
            "z-50 max-h-[18rem] min-w-[var(--radix-select-trigger-width)] overflow-hidden",
            "rounded-lg border border-rule-strong bg-tape-raised",
            "shadow-[0_10px_28px_-10px_rgba(12,18,26,0.35)]",
            "data-[state=open]:animate-[fade-in_120ms_ease-out]",
          )}
        >
          <SelectPrimitive.Viewport className="p-1">
            {options.map((option) => (
              <SelectPrimitive.Item
                key={option.value}
                value={option.value}
                className={cn(
                  "relative flex cursor-default select-none items-center gap-2 rounded-md",
                  "py-1.5 pl-6 pr-2.5 text-sm text-ink outline-none",
                  "data-[highlighted]:bg-mark-soft data-[highlighted]:text-ink",
                  "data-[state=checked]:font-medium",
                )}
              >
                <SelectPrimitive.ItemIndicator className="absolute left-1.5 text-mark">
                  <Check size={13} strokeWidth={2.25} />
                </SelectPrimitive.ItemIndicator>
                <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
