import type { ReactNode } from "react";

export function Section({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-24">
      <div className="mb-6 max-w-2xl space-y-1.5">
        <h2 id={`${id}-title`} className="text-headline">
          {title}
        </h2>
        <p className="text-pretty text-muted-foreground">{description}</p>
      </div>
      {children}
    </section>
  );
}
