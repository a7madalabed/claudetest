"use client";

import { Label as LabelPrimitive } from "radix-ui";
import { createContext, useContext, useId, type ComponentProps, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Accessible form fields.
 *
 * <Field label="Amount" description="…" error="…"><Input /></Field>
 *
 * Field generates IDs and wires them up automatically so screen readers announce
 * the label, the hint AND the error when the input is focused — something that is
 * very easy to forget when done by hand on every form.
 */
type FieldContextValue = { id: string; describedBy: string | undefined; invalid: boolean };
const FieldContext = createContext<FieldContextValue | null>(null);

export function Field({
  label,
  description,
  error,
  className,
  children,
}: {
  label: ReactNode;
  description?: ReactNode;
  error?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const id = useId();
  const descriptionId = description ? `${id}-description` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [descriptionId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <FieldContext.Provider value={{ id, describedBy, invalid: Boolean(error) }}>
      <div className={cn("grid gap-1.5", className)}>
        <LabelPrimitive.Root htmlFor={id} className="text-sm font-medium">
          {label}
        </LabelPrimitive.Root>
        {children}
        {description && !error && (
          <p id={descriptionId} className="text-caption text-muted-foreground">
            {description}
          </p>
        )}
        {error && (
          <p id={errorId} role="alert" className="text-caption font-medium text-negative">
            {error}
          </p>
        )}
      </div>
    </FieldContext.Provider>
  );
}

/** A native <select>, labelled and described by its surrounding <Field>. */
export function NativeSelect({ className, ...props }: ComponentProps<"select">) {
  const field = useContext(FieldContext);
  return (
    <select
      id={field?.id}
      aria-describedby={field?.describedBy}
      aria-invalid={field?.invalid || undefined}
      className={cn(
        "h-10 w-full rounded-lg border border-input bg-surface px-3 text-sm shadow-elevation-1 outline-none",
        "focus-visible:border-ring focus-visible:ring-4 focus-visible:ring-ring/20 disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export function Input({
  className,
  prefix,
  ...props
}: Omit<ComponentProps<"input">, "prefix"> & { prefix?: ReactNode }) {
  const field = useContext(FieldContext);

  const input = (
    <input
      id={field?.id}
      aria-describedby={field?.describedBy}
      aria-invalid={field?.invalid || undefined}
      className={cn(
        "h-10 w-full min-w-0 rounded-lg border border-input bg-surface px-3 text-sm shadow-elevation-1",
        "transition-[border-color,box-shadow] duration-150 outline-none",
        "placeholder:text-muted-foreground/70",
        "focus-visible:border-ring focus-visible:ring-4 focus-visible:ring-ring/20 focus-visible:outline-none",
        "aria-invalid:border-negative aria-invalid:focus-visible:ring-negative/20",
        "disabled:cursor-not-allowed disabled:opacity-50",
        prefix != null && "pl-8",
        className,
      )}
      {...props}
    />
  );

  if (prefix == null) return input;
  return (
    <div className="relative">
      <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-muted-foreground">
        {prefix}
      </span>
      {input}
    </div>
  );
}
