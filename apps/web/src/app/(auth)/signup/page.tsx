import type { Metadata } from "next";
import { SignupForm } from "@/components/auth/signup-form";

export const metadata: Metadata = { title: "Create your account" };

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; email?: string }>;
}) {
  const { next, email } = await searchParams;
  return (
    <div className="animate-rise space-y-8">
      <div className="space-y-2">
        <h1 className="text-headline">Create your account</h1>
        <p className="text-muted-foreground">
          Start with a household of your own — invite others later.
        </p>
      </div>
      <SignupForm next={next} email={email} />
    </div>
  );
}
