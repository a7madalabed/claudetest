import type { Metadata } from "next";
import { LoginForm } from "@/components/auth/login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  return (
    <div className="animate-rise space-y-8">
      <div className="space-y-2">
        <h1 className="text-headline">Welcome back</h1>
        <p className="text-muted-foreground">Sign in to your Ledgerly account.</p>
      </div>
      <LoginForm next={next} />
    </div>
  );
}
