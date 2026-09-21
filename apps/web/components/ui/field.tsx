import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { cn } from "./cn";

/*
 * The form-control vocabulary. Every control in the app is one of these, at one height,
 * with one corner radius and one border weight — the "same form-control vocabulary"
 * rule, enforced by there being nowhere else to get an input from.
 *
 * Inputs sit *sunk* into the tape rather than raised off it: on a printed form the field
 * is the part that was left blank for you to write in.
 */
export const controlClass =
  "w-full rounded-[2px] border bg-tape-sunk px-2.5 text-sm text-ink " +
  "border-rule-strong placeholder:text-ink-3 " +
  "transition-colors duration-150 hover:border-ink-3 " +
  "focus:border-mark focus:bg-tape-raised " +
  "disabled:cursor-not-allowed disabled:opacity-55";

export function FieldShell({
  id,
  label,
  optional,
  help,
  error,
  children,
}: {
  id: string;
  label: string;
  optional?: boolean;
  help?: ReactNode;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="mb-3.5 last:mb-0">
      <label htmlFor={id} className="caption mb-1 flex items-baseline gap-1.5 text-ink-2">
        <span>{label}</span>
        {optional ? <span className="font-medium normal-case tracking-normal text-ink-3">optional</span> : null}
      </label>
      {children}
      {help ? <p className="mt-1 text-xs leading-snug text-ink-3">{help}</p> : null}
      {error ? (
        <p className="mt-1 flex gap-1.5 text-xs font-medium text-ribbon">
          <span aria-hidden className="select-none">&#8226;</span>
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  );
}

export function TextInput({
  invalid,
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  return (
    <input
      className={cn(
        controlClass,
        "h-9",
        invalid && "border-ribbon bg-ribbon-soft",
        props.type === "number" && "[font-variant-numeric:tabular-nums]",
        className,
      )}
      {...props}
    />
  );
}

export function TextArea({
  invalid,
  className,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }) {
  return (
    <textarea
      className={cn(controlClass, "py-2 leading-relaxed", invalid && "border-ribbon bg-ribbon-soft", className)}
      {...props}
    />
  );
}

/**
 * The native select, for the one case Radix's does not serve: a `<form>` posted without
 * JavaScript, which is how the collections filter stays a plain GET and therefore stays
 * deep-linkable. Everywhere a value is held in React state, use `<Select>` instead.
 */
export function NativeSelect({
  className,
  compact,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { compact?: boolean }) {
  return (
    <select
      className={cn(
        controlClass,
        "select-chevron",
        compact ? "select-chevron-sm h-7 w-auto pl-1.5 pr-5 text-xs" : "h-9 pr-8",
        className,
      )}
      {...props}
    />
  );
}
