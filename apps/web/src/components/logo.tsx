import { cn } from "@/lib/utils";

export function Logo({
  className,
  withWordmark = true,
}: {
  className?: string;
  withWordmark?: boolean;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2 font-semibold tracking-tight", className)}>
      <svg viewBox="0 0 32 32" className="size-7" aria-hidden>
        <rect width="32" height="32" rx="9" className="fill-primary" />
        <path
          d="M10 9v14h12"
          fill="none"
          strokeWidth="3.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="stroke-primary-foreground"
        />
        <circle cx="21.5" cy="11.5" r="2.5" className="fill-primary-foreground" />
      </svg>
      {withWordmark && <span>Ledgerly</span>}
    </span>
  );
}
