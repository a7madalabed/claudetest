"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { PasswordResetRequestSchema } from "@ledgerly/shared";
import { MailCheck } from "lucide-react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { usePasswordResetRequest } from "@/lib/query/hooks";
import { FormAlert } from "./form-alert";

export function ForgotPasswordForm() {
  const request = usePasswordResetRequest();
  const form = useForm<
    z.input<typeof PasswordResetRequestSchema>,
    unknown,
    z.output<typeof PasswordResetRequestSchema>
  >({
    resolver: zodResolver(PasswordResetRequestSchema),
    /*
     * Validate on SUBMIT, then live as they fix things. Validating when a field
     * loses focus put "Enter a valid email address" above the links below the
     * form the moment you clicked one: the link jumped 11 px mid-click, and the
     * click missed (found by the Stage 15 browser tests).
     */
    mode: "onSubmit",
    reValidateMode: "onChange",
    defaultValues: { email: "" },
  });

  if (request.isSuccess) {
    // The same message whether or not the address has an account: telling them
    // apart would let anyone check who uses Ledgerly.
    return (
      <div role="status" className="grid gap-4">
        <MailCheck className="size-8 text-primary" aria-hidden />
        <p>
          If an account uses <strong>{form.getValues("email")}</strong>, we&apos;ve sent it a link
          to choose a new password. It works for one hour.
        </p>
        <p className="text-sm text-muted-foreground">
          Nothing arrived? Check your spam folder, or{" "}
          <button
            type="button"
            className="font-medium text-primary underline-offset-4 hover:underline"
            onClick={() => request.reset()}
          >
            try another address
          </button>
          .
        </p>
      </div>
    );
  }

  return (
    <form
      onSubmit={form.handleSubmit((values) => request.mutate(values))}
      noValidate
      className="grid gap-4"
    >
      <FormAlert error={request.error} />
      <Field label="Email" error={form.formState.errors.email?.message}>
        <Input
          type="email"
          autoComplete="email"
          autoFocus
          placeholder="you@example.com"
          {...form.register("email")}
        />
      </Field>
      <Button type="submit" size="lg" loading={request.isPending} className="mt-2 w-full">
        Send reset link
      </Button>
      <p className="text-center text-sm text-muted-foreground">
        Remembered it?{" "}
        <Link href="/login" className="font-medium text-primary underline-offset-4 hover:underline">
          Sign in
        </Link>
      </p>
    </form>
  );
}
