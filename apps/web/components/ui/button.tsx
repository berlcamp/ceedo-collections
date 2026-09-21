import type { ButtonHTMLAttributes } from "react";
import { cn } from "./cn";

/*
 * One button shape for the whole app: 8px corners off the shared radius root, never varying
 * by variant. Primary is navy, never brass — brass is an ornament in this system, not a verb.
 *
 * `danger` is the only variant that carries the ribbon red, and it is reserved for acts
 * that dispose of cash already taken: voiding a receipt, spoiling a form. Colour is the
 * scarce resource in this world.
 */
export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-primary text-primary-foreground border border-primary hover:bg-primary/90 hover:border-primary/90 active:bg-primary/95",
  secondary:
    "bg-tape-raised text-ink border border-rule-strong hover:bg-tape-hover active:bg-tape-sunk",
  ghost:
    "bg-transparent text-ink-2 border border-transparent hover:bg-tape-sunk hover:text-ink active:bg-rule-soft",
  danger:
    "bg-ribbon text-tape-raised border border-ribbon hover:bg-ribbon-deep hover:border-ribbon-deep active:bg-ribbon-deeper",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "h-7 px-2 text-xs gap-1.5",
  md: "h-8 px-2.5 text-sm gap-1.5",
};

export function buttonClass(
  variant: ButtonVariant = "secondary",
  size: ButtonSize = "md",
  extra?: string,
): string {
  return cn(
    "inline-flex shrink-0 items-center justify-center rounded-lg font-medium whitespace-nowrap",
    "transition-colors duration-150",
    "disabled:pointer-events-none disabled:opacity-45",
    VARIANTS[variant],
    SIZES[size],
    extra,
  );
}

export function Button({
  variant = "secondary",
  size = "md",
  className,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
}) {
  return <button type={type} className={buttonClass(variant, size, className)} {...props} />;
}
