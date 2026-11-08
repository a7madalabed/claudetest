import { cn } from "@/lib/utils";

/**
 * The mark is a closed ledger: a cloth cover, the groove of the spine, an L,
 * and a red ribbon hanging out of the top, like the bookmark in the app's
 * sidebar.
 */
export function Logo({
  className,
  withWordmark = true,
}: {
  className?: string;
  withWordmark?: boolean;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <svg viewBox="0 0 32 32" className="size-7" aria-hidden>
        <rect width="32" height="32" rx="3.5" className="fill-primary" />
        <path
          d="M8.5 0v32"
          fill="none"
          strokeWidth="1.4"
          className="stroke-primary-foreground"
          opacity="0.3"
        />
        <path
          d="M14 9.5v12.5h8.5"
          fill="none"
          strokeWidth="3"
          strokeLinecap="square"
          strokeLinejoin="miter"
          className="stroke-primary-foreground"
        />
        <path d="M23 0h5.5v13.5l-2.75-2.6-2.75 2.6z" className="fill-negative" />
      </svg>
      {withWordmark && <span className="font-display text-lg font-semibold">Ledgerly</span>}
    </span>
  );
}
