import type { Metadata } from "next";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";

export const metadata: Metadata = { title: "Forgot password" };

export default function ForgotPasswordPage() {
  return (
    <div className="animate-rise space-y-8">
      <div className="space-y-2">
        <h1 className="text-headline">Forgot your password?</h1>
        <p className="text-muted-foreground">We&apos;ll email you a link to choose a new one.</p>
      </div>
      <ForgotPasswordForm />
    </div>
  );
}
