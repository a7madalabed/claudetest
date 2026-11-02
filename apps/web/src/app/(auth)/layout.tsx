import Link from "next/link";
import type { ReactNode } from "react";
import { AuthShowcase } from "@/components/auth/auth-showcase";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";

/**
 * Shared layout for sign-in / sign-up / 2FA. A route GROUP — the "(auth)" folder
 * name doesn't appear in the URL; it just lets these pages share this layout.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <div className="flex flex-col px-6 py-6 sm:px-10">
        <header className="flex items-center justify-between">
          <Link href="/" className="rounded-lg">
            <Logo />
          </Link>
          <ThemeToggle />
        </header>
        <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-12">
          {children}
        </main>
        <footer className="text-center text-caption text-muted-foreground">
          Protected by Argon2id, HttpOnly sessions and optional 2FA.
        </footer>
      </div>
      <AuthShowcase />
    </div>
  );
}
