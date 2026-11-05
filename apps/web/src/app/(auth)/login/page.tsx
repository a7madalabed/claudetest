import type { Metadata } from "next";
import { LoginForm } from "@/components/auth/login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; email?: string; deleted?: string }>;
}) {
  const { next, email, deleted } = await searchParams;
  return (
    <div className="animate-rise space-y-8">
      <div className="space-y-2">
        <h1 className="text-headline">Welcome back</h1>
        <p className="text-muted-foreground">Sign in to your Ledgerly account.</p>
      </div>
      {deleted && (
        <p role="status" className="rounded-xl bg-muted p-3 text-sm">
          Your account has been deleted. We&apos;ve sent you a confirmation email.
        </p>
      )}
      <LoginForm next={next} email={email} />
    </div>
  );
}
