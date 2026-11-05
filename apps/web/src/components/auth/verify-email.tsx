"use client";

import { CheckCircle2, Loader2, MailX } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/api/errors";
import { useVerifyEmail } from "@/lib/query/hooks";

/** Confirms the address as soon as the page opens: opening the link IS the confirmation. */
export function VerifyEmail({ token }: { token: string }) {
  const verify = useVerifyEmail();
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return; // React's strict mode runs effects twice in development
    started.current = true;
    verify.mutate(token);
  }, [token, verify]);

  if (verify.isSuccess) {
    return (
      <div role="status" className="grid gap-4">
        <CheckCircle2 className="size-8 text-positive" aria-hidden />
        <h1 className="text-headline">Email confirmed</h1>
        <p className="text-muted-foreground">Thanks — your address is verified.</p>
        <Button asChild size="lg">
          <Link href="/app">Open Ledgerly</Link>
        </Button>
      </div>
    );
  }
  if (verify.isError) {
    return (
      <div role="alert" className="grid gap-4">
        <MailX className="size-8 text-negative" aria-hidden />
        <h1 className="text-headline">This link didn&apos;t work</h1>
        <p className="text-muted-foreground">{errorMessage(verify.error)}</p>
        <p className="text-sm text-muted-foreground">
          Sign in and use &ldquo;Resend&rdquo; on the banner at the top of the app to get a new one.
        </p>
        <Button asChild size="lg" variant="outline">
          <Link href="/app">Sign in</Link>
        </Button>
      </div>
    );
  }
  return (
    <p role="status" className="flex items-center gap-2 text-muted-foreground">
      <Loader2 className="size-4 animate-spin" aria-hidden /> Confirming your email…
    </p>
  );
}
