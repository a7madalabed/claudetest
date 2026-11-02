"use client";

import { Check, ChevronRight } from "lucide-react";
import { DropdownMenu as Primitive } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/**
 * Menus built on Radix: arrow-key navigation, type-ahead, Esc to close and focus
 * management come for free (the WAI-ARIA "menu" pattern).
 */
export const DropdownMenu = Primitive.Root;
export const DropdownMenuTrigger = Primitive.Trigger;
export const DropdownMenuGroup = Primitive.Group;
export const DropdownMenuSub = Primitive.Sub;
export const DropdownMenuRadioGroup = Primitive.RadioGroup;

const surface =
  "z-50 min-w-48 overflow-hidden rounded-xl border border-border bg-surface-raised p-1 text-sm shadow-elevation-3 origin-(--radix-dropdown-menu-content-transform-origin) data-[state=closed]:animate-pop-out data-[state=open]:animate-pop-in";

export function DropdownMenuContent({
  className,
  sideOffset = 6,
  ...props
}: ComponentProps<typeof Primitive.Content>) {
  return (
    <Primitive.Portal>
      <Primitive.Content sideOffset={sideOffset} className={cn(surface, className)} {...props} />
    </Primitive.Portal>
  );
}

const itemStyles =
  "relative flex cursor-default items-center gap-2 rounded-lg px-2.5 py-2 outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:bg-muted [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground";

export function DropdownMenuItem({
  className,
  destructive,
  ...props
}: ComponentProps<typeof Primitive.Item> & { destructive?: boolean }) {
  return (
    <Primitive.Item
      className={cn(
        itemStyles,
        destructive && "text-negative data-[highlighted]:bg-negative-subtle [&_svg]:text-negative",
        className,
      )}
      {...props}
    />
  );
}

export function DropdownMenuRadioItem({
  className,
  children,
  ...props
}: ComponentProps<typeof Primitive.RadioItem>) {
  return (
    <Primitive.RadioItem className={cn(itemStyles, "pr-8", className)} {...props}>
      {children}
      <Primitive.ItemIndicator className="absolute right-2.5">
        <Check className="!text-primary" />
      </Primitive.ItemIndicator>
    </Primitive.RadioItem>
  );
}

export function DropdownMenuSubTrigger({
  className,
  children,
  ...props
}: ComponentProps<typeof Primitive.SubTrigger>) {
  return (
    <Primitive.SubTrigger
      className={cn(itemStyles, "data-[state=open]:bg-muted", className)}
      {...props}
    >
      {children}
      <ChevronRight className="ml-auto" />
    </Primitive.SubTrigger>
  );
}

export function DropdownMenuSubContent({
  className,
  ...props
}: ComponentProps<typeof Primitive.SubContent>) {
  return (
    <Primitive.Portal>
      <Primitive.SubContent className={cn(surface, className)} {...props} />
    </Primitive.Portal>
  );
}

export function DropdownMenuLabel({ className, ...props }: ComponentProps<typeof Primitive.Label>) {
  return (
    <Primitive.Label
      className={cn("px-2.5 py-1.5 text-caption text-muted-foreground", className)}
      {...props}
    />
  );
}

export function DropdownMenuSeparator({
  className,
  ...props
}: ComponentProps<typeof Primitive.Separator>) {
  return <Primitive.Separator className={cn("-mx-1 my-1 h-px bg-border", className)} {...props} />;
}
