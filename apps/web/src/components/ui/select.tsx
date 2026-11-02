"use client";

import { Check, ChevronDown } from "lucide-react";
import { Select as Primitive } from "radix-ui";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * A styled select on Radix: keyboard and screen-reader behaviour of a native
 * <select> (arrow keys, type-ahead, Esc), with our own look. Wired into <Field>
 * through `id` so the label still points at it.
 */
export function Select({
  value,
  onValueChange,
  placeholder,
  children,
  id,
  invalid,
  disabled,
  className,
  "aria-label": ariaLabel,
}: {
  value: string | undefined;
  onValueChange: (value: string) => void;
  placeholder?: string;
  children: ReactNode;
  id?: string;
  invalid?: boolean;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
}) {
  return (
    <Primitive.Root value={value} onValueChange={onValueChange} disabled={disabled}>
      <Primitive.Trigger
        id={id}
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        className={cn(
          "flex h-10 w-full items-center justify-between gap-2 rounded-lg border border-input bg-surface px-3 text-left text-sm shadow-elevation-1",
          "transition-[border-color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-4 focus-visible:ring-ring/20",
          "aria-invalid:border-negative disabled:cursor-not-allowed disabled:opacity-50 data-[placeholder]:text-muted-foreground",
          className,
        )}
      >
        <span className="truncate">
          <Primitive.Value placeholder={placeholder} />
        </span>
        <Primitive.Icon>
          <ChevronDown className="size-4 text-muted-foreground" />
        </Primitive.Icon>
      </Primitive.Trigger>
      <Primitive.Portal>
        <Primitive.Content
          position="popper"
          sideOffset={6}
          className="z-50 max-h-(--radix-select-content-available-height) min-w-(--radix-select-trigger-width) overflow-hidden rounded-xl border border-border bg-surface-raised p-1 shadow-elevation-3 data-[state=open]:animate-pop-in"
        >
          <Primitive.Viewport>{children}</Primitive.Viewport>
        </Primitive.Content>
      </Primitive.Portal>
    </Primitive.Root>
  );
}

export function SelectItem({
  value,
  children,
  className,
}: {
  value: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Primitive.Item
      value={value}
      className={cn(
        "relative flex cursor-default items-center gap-2 rounded-lg py-2 pr-8 pl-2.5 text-sm outline-none select-none data-[highlighted]:bg-muted [&_svg]:size-4 [&_svg]:text-muted-foreground",
        className,
      )}
    >
      <Primitive.ItemText>{children}</Primitive.ItemText>
      <Primitive.ItemIndicator className="absolute right-2.5">
        <Check className="!text-primary" />
      </Primitive.ItemIndicator>
    </Primitive.Item>
  );
}
