import type { Metadata } from "next";
import { VerifyEmail } from "@/components/auth/verify-email";

export const metadata: Metadata = { title: "Confirm your email" };

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  return (
    <div className="animate-rise space-y-8">
      {token ? <VerifyEmail token={token} /> : <p role="alert">This link is incomplete.</p>}
    </div>
  );
}
