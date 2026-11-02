import { ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import { MfaForm } from "@/components/auth/mfa-form";

export const metadata: Metadata = { title: "Two-factor authentication" };

export default async function VerifyPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  return (
    <div className="animate-rise space-y-8">
      <div className="space-y-3">
        <span className="flex size-11 items-center justify-center rounded-xl bg-primary-subtle text-primary">
          <ShieldCheck className="size-5" />
        </span>
        <h1 className="text-headline">Two-factor authentication</h1>
        <p className="text-muted-foreground">Enter the 6-digit code from your authenticator app.</p>
      </div>
      <MfaForm next={next} />
    </div>
  );
}
