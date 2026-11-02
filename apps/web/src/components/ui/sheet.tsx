"use client";

import { X } from "lucide-react";
import { Dialog as Primitive } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/** A panel that slides in from the side — used for navigation on small screens. */
export const Sheet = Primitive.Root;
export const SheetTrigger = Primitive.Trigger;
export const SheetClose = Primitive.Close;
export const SheetTitle = Primitive.Title;

export function SheetContent({
  className,
  children,
  ...props
}: ComponentProps<typeof Primitive.Content>) {
  return (
    <Primitive.Portal>
      <Primitive.Overlay className="fixed inset-0 z-50 bg-overlay data-[state=closed]:animate-overlay-out data-[state=open]:animate-overlay-in" />
      <Primitive.Content
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col border-r border-border bg-background shadow-elevation-3",
          "data-[state=closed]:animate-sheet-out data-[state=open]:animate-sheet-in",
          className,
        )}
        {...props}
      >
        {children}
        <Primitive.Close
          className="absolute top-3.5 right-3 rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Close menu"
        >
          <X className="size-4" />
        </Primitive.Close>
      </Primitive.Content>
    </Primitive.Portal>
  );
}
