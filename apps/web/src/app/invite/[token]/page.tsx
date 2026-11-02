import type { Metadata } from "next";
import Link from "next/link";
import { InviteLanding } from "@/components/household/invite-landing";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";

export const metadata: Metadata = {
  title: "You're invited",
  // Invitation links are private: never let a search engine index one.
  robots: { index: false, follow: false },
  // Don't leak the token to other sites through the Referer header.
  referrer: "no-referrer",
};

/** Public on purpose: the invitee may not have an account yet. */
export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <div className="flex min-h-dvh flex-col px-6 py-6 sm:px-10">
      <header className="flex items-center justify-between">
        <Link href="/" className="rounded-lg">
          <Logo />
        </Link>
        <ThemeToggle />
      </header>
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center py-12">
        <InviteLanding token={token} />
      </main>
    </div>
  );
}
