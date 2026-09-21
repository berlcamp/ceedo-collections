"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useRef, type ReactNode } from "react";
import { cn } from "./cn";

/*
 * Radix Dialog, dressed as a docket lifted off the tape and laid on the chassis.
 *
 * Why Radix rather than the `<dialog>` element this app used before: focus trapping,
 * restore-on-close, `aria-labelledby`/`describedby` wiring, scroll locking and Escape
 * handling are all behaviours we would otherwise be reimplementing badly, and this app's
 * confirmed accessibility need is keyboard-complete operation for a clerk working a
 * reconciliation all day.
 */

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({
  title,
  description,
  children,
  footer,
  width = "md",
  tone = "neutral",
}: {
  title: string;
  /** Says what the action will do. Required: every dialog here disposes of something. */
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: "sm" | "md" | "lg";
  /** `danger` marks a dialog that voids or writes off money already collected. */
  tone?: "neutral" | "danger";
}) {
  const contentRef = useRef<HTMLDivElement>(null);

  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay
        className={cn(
          "fixed inset-0 z-50 bg-chassis-900/55",
          "data-[state=open]:animate-[fade-in_150ms_ease-out]",
        )}
      />
      <DialogPrimitive.Content
        ref={contentRef}
        onOpenAutoFocus={(event) => {
          // Radix focuses the first tabbable node, which here is the close button in the
          // docket's head. Send it to the first real field; fall back to Radix's own
          // behaviour when the dialog has no field to land on.
          const first = contentRef.current?.querySelector<HTMLElement>(
            "input:not([type='hidden']), textarea, [role='combobox']",
          );
          if (!first) return;
          event.preventDefault();
          first.focus();
        }}
        className={cn(
          "fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2",
          "flex max-h-[min(90vh,52rem)] w-[calc(100vw-2rem)] flex-col",
          width === "sm" && "sm:w-[22rem]",
          width === "md" && "sm:w-[30rem]",
          width === "lg" && "sm:w-[44rem]",
          "rounded-xl border border-chassis-600 bg-tape-raised",
          "shadow-[0_18px_44px_-12px_rgba(12,18,26,0.45)]",
          "data-[state=open]:animate-[docket-in_180ms_cubic-bezier(0.16,1,0.3,1)]",
        )}
      >
        {/* The dialog's head sits on the chassis: this sheet was pulled out of the
            machine, and the colour break is what says so. */}
        <div
          className={cn(
            "flex items-start gap-4 border-b px-5 py-3.5",
            tone === "danger"
              ? "border-ribbon/40 bg-ribbon text-tape-raised"
              : "border-chassis-600 bg-chassis-900 text-chassis-ink",
          )}
        >
          <div className="min-w-0 flex-1">
            <DialogPrimitive.Title className="text-sm font-semibold tracking-[-0.01em]">
              {title}
            </DialogPrimitive.Title>
            {description ? (
              <DialogPrimitive.Description
                className={cn(
                  "mt-1 text-xs leading-relaxed",
                  tone === "danger" ? "text-tape-raised/85" : "text-chassis-dim",
                )}
              >
                {description}
              </DialogPrimitive.Description>
            ) : null}
          </div>
          <DialogPrimitive.Close
            aria-label="Close"
            className={cn(
              "on-chassis -mr-1 mt-px shrink-0 rounded-md p-1 transition-colors duration-150",
              tone === "danger"
                ? "text-tape-raised/70 hover:bg-black/15 hover:text-tape-raised"
                : "text-chassis-dim hover:bg-chassis-700 hover:text-chassis-ink",
            )}
          >
            <X size={15} strokeWidth={1.75} />
          </DialogPrimitive.Close>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>

        {footer ? (
          <div className="flex items-center justify-end gap-2 border-t border-rule bg-tape px-5 py-3">
            {footer}
          </div>
        ) : null}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
