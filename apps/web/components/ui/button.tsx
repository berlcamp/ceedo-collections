import type { ButtonHTMLAttributes } from "react";
import { cn } from "./cn";

/*
 * One button shape for the whole app. Proof Tape is rectilinear — a form's boxes, not
 * pills — so the corner language is 2px everywhere and never varies by variant.
 *
 * `danger` is the only variant that carries the ribbon red, and it is reserved for acts
 * that dispose of cash already taken: voiding a receipt, spoiling a form. Colour is the
 * scarce resource in this world.
 */
export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-chassis-900 text-chassis-ink border border-chassis-900 hover:bg-chassis-700 hover:border-chassis-700 active:bg-chassis-850",
  secondary:
    "bg-tape-raised text-ink border border-rule-strong hover:bg-tape-hover active:bg-tape-sunk",
  ghost:
    "bg-transparent text-ink-2 border border-transparent hover:bg-tape-sunk hover:text-ink active:bg-rule-soft",
  danger:
    "bg-ribbon text-tape-raised border border-ribbon hover:bg-ribbon-deep hover:border-ribbon-deep active:bg-ribbon-deeper",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "h-7 px-2.5 text-xs gap-1.5",
  md: "h-9 px-3.5 text-sm gap-2",
};

export function buttonClass(
  variant: ButtonVariant = "secondary",
  size: ButtonSize = "md",
  extra?: string,
): string {
  return cn(
    "inline-flex shrink-0 items-center justify-center rounded-[2px] font-medium whitespace-nowrap",
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
