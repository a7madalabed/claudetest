import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";

/** Public, signed-out pages that explain the rules: privacy and terms. */
export default function LegalLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto min-h-dvh max-w-2xl px-6 py-6 sm:px-10">
      <header className="flex items-center justify-between pb-10">
        <Link href="/" className="rounded-lg">
          <Logo />
        </Link>
        <ThemeToggle />
      </header>
      <main className="pb-16">{children}</main>
    </div>
  );
}
