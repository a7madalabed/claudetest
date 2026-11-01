import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import { Slot } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/**
 * Buttons are defined with `cva` (class-variance-authority): every visual option
 * is a named, typed variant instead of ad-hoc class strings scattered around the app.
 */
export const buttonVariants = cva(
  [
    "relative inline-flex shrink-0 items-center justify-center gap-2 font-medium whitespace-nowrap select-none",
    "transition-[background-color,color,box-shadow,transform,opacity] duration-150 ease-out",
    // Tactile press feedback: a tiny scale-down while pressed (CSS — zero JS cost).
    "active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
    "[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  ],
  {
    variants: {
      variant: {
        primary:
          "bg-primary text-primary-foreground shadow-elevation-1 hover:bg-primary/90 hover:shadow-elevation-2",
        secondary: "bg-muted text-foreground hover:bg-muted/70",
        outline: "border border-input bg-surface text-foreground shadow-elevation-1 hover:bg-muted",
        ghost: "text-foreground hover:bg-muted",
        destructive:
          "bg-negative text-white shadow-elevation-1 hover:bg-negative/90 dark:text-black",
        link: "text-primary underline-offset-4 hover:underline active:scale-100",
      },
      size: {
        sm: "h-8 rounded-md px-3 text-sm",
        md: "h-10 rounded-lg px-4 text-sm",
        lg: "h-12 rounded-xl px-6 text-base",
        icon: "size-10 rounded-lg",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export type ButtonProps = ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    /** Render the child element (e.g. a Next.js <Link>) with button styles. */
    asChild?: boolean;
    /** Shows a spinner, disables the button and announces "busy" to screen readers. */
    loading?: boolean;
  };

export function Button({
  className,
  variant,
  size,
  asChild = false,
  loading = false,
  disabled,
  children,
  ...props
}: ButtonProps) {
  const Component = asChild ? Slot.Root : "button";

  return (
    <Component
      data-slot="button"
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {asChild ? (
        children
      ) : (
        <>
          {/* The label stays in the layout (just invisible) so the button never
              changes width when the spinner appears — no layout jump. */}
          <span className={cn("inline-flex items-center gap-2", loading && "invisible")}>
            {children}
          </span>
          {loading && (
            <Loader2 aria-hidden className="absolute animate-spin" data-testid="button-spinner" />
          )}
        </>
      )}
    </Component>
  );
}
