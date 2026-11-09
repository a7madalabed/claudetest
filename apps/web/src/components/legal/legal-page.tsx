import Link from "next/link";
import type { ReactNode } from "react";
import { legalOperator } from "@/lib/legal";

/** Headings and spacing for the long-form legal pages (no typography plugin needed). */
export function LegalSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="font-display text-xl font-semibold">{title}</h2>
      {children}
    </section>
  );
}

/** Links inside sentences are always underlined: colour alone can't mark a link (WCAG 1.4.1). */
export const legalLink = "font-medium text-primary underline underline-offset-4";

/** Who to write to, taken from the deployment's settings; says nothing if they aren't set. */
export function ContactLine() {
  const { name, email } = legalOperator();
  if (!name && !email) return null;
  return (
    <LegalSection title="Who to ask">
      <p>
        {name ? `Ledgerly is run by ${name}. ` : ""}
        {email ? (
          <>
            For questions, or to ask about your data, write to{" "}
            <a href={`mailto:${email}`} className={legalLink}>
              {email}
            </a>
            .
          </>
        ) : null}
      </p>
    </LegalSection>
  );
}

export function LegalPage({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: ReactNode;
}) {
  return (
    <article className="space-y-8">
      <header className="space-y-2">
        <h1 className="text-headline">{title}</h1>
        <p className="text-sm text-muted-foreground">Last updated {updated}</p>
      </header>
      <div className="space-y-8 text-base leading-relaxed [&_li]:ml-5 [&_li]:list-disc [&_ul]:space-y-2">
        {children}
      </div>
      <ContactLine />
      <p className="border-t border-border pt-6 text-sm text-muted-foreground">
        <Link href="/privacy" className={legalLink}>
          Privacy
        </Link>{" "}
        ·{" "}
        <Link href="/terms" className={legalLink}>
          Terms
        </Link>
      </p>
    </article>
  );
}
