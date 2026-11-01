"use client";

import { Tooltip as TooltipPrimitive } from "radix-ui";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

export const TooltipProvider = TooltipPrimitive.Provider;

/** <Tooltip content="Export as CSV"><Button …/></Tooltip> */
export function Tooltip({
  content,
  children,
  side = "top",
  className,
  ...props
}: Omit<ComponentProps<typeof TooltipPrimitive.Content>, "content"> & {
  content: ReactNode;
  children: ReactNode;
}) {
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={6}
          className={cn(
            "z-50 rounded-md bg-foreground px-2 py-1 text-xs font-medium text-background shadow-elevation-2",
            "origin-(--radix-tooltip-content-transform-origin) data-[state=closed]:animate-pop-out data-[state=delayed-open]:animate-pop-in data-[state=instant-open]:animate-pop-in",
            className,
          )}
          {...props}
        >
          {content}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
