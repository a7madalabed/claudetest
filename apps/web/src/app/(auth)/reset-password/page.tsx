import type { Metadata } from "next";
import Link from "next/link";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";

export const metadata: Metadata = { title: "Choose a new password" };

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  return (
    <div className="animate-rise space-y-8">
      <div className="space-y-2">
        <h1 className="text-headline">Choose a new password</h1>
        <p className="text-muted-foreground">
          Every device signed in to your account will be signed out.
        </p>
      </div>
      {token ? (
        <ResetPasswordForm token={token} />
      ) : (
        <p role="alert">
          This link is incomplete.{" "}
          <Link
            href="/forgot-password"
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            Ask for a new one
          </Link>
          .
        </p>
      )}
    </div>
  );
}
