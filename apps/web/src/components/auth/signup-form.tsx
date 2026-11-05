"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { SignupSchema, type SignupInput } from "@ledgerly/shared";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm, useWatch } from "react-hook-form";
import type { z } from "zod";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { PasswordInput } from "@/components/ui/password-input";
import { isApiError } from "@/lib/api/errors";
import { useSignup } from "@/lib/query/hooks";
import { FormAlert } from "./form-alert";
import { safeNext } from "./login-form";
import { PasswordStrength } from "./password-strength";

export function SignupForm({ next, email }: { next?: string; email?: string }) {
  const router = useRouter();
  const signup = useSignup();
  // The SAME schema the API validates with: identical rules, instant feedback.
  const form = useForm<z.input<typeof SignupSchema>, unknown, SignupInput>({
    resolver: zodResolver(SignupSchema),
    /*
     * Validate on SUBMIT, then live as they fix things. Validating when a field
     * loses focus put "Enter a valid email address" above the links below the
     * form the moment you clicked one: the link jumped 11 px mid-click, and the
     * click missed (found by the Stage 15 browser tests).
     */
    mode: "onSubmit",
    reValidateMode: "onChange",
    defaultValues: { displayName: "", email: email ?? "", password: "" },
  });
  const { errors } = form.formState;
  // useWatch subscribes to ONE field, so typing re-renders only what depends on it.
  const password = useWatch({ control: form.control, name: "password" });

  const onSubmit = form.handleSubmit((values) =>
    signup.mutate(values, {
      onSuccess: (me) => {
        // Came from an invitation? Go back to it to accept; otherwise, to your new household.
        router.replace(next ? safeNext(next) : `/app/${me.households[0]!.id}`);
        router.refresh();
      },
      onError: (error) => {
        // Put server-side field errors (weak password, email taken) on the right field.
        if (isApiError(error)) {
          for (const field of ["email", "password", "displayName"] as const) {
            const message =
              error.code === "email_taken" && field === "email"
                ? error.detail
                : error.fieldError(field);
            if (message) form.setError(field, { message }, { shouldFocus: true });
          }
        }
      },
    }),
  );

  const fieldLevel =
    isApiError(signup.error) &&
    (signup.error.fieldErrors.length > 0 || signup.error.code === "email_taken");

  // method="post": if this form is ever submitted before the app's JavaScript
  // takes over (a slow connection, a tab opened before a deploy), the browser
  // must not put the fields, a password among them, in the URL, where history
  // and access logs keep them (Stage 16).
  return (
    <form method="post" onSubmit={onSubmit} noValidate className="grid gap-4">
      <FormAlert error={fieldLevel ? null : signup.error} />
      <Field label="Your name" error={errors.displayName?.message}>
        <Input
          autoComplete="name"
          autoFocus
          placeholder="Alex Rivera"
          {...form.register("displayName")}
        />
      </Field>
      <Field label="Email" error={errors.email?.message}>
        <Input
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          {...form.register("email")}
        />
      </Field>
      <Field label="Password" error={errors.password?.message}>
        <PasswordInput autoComplete="new-password" {...form.register("password")} />
      </Field>
      <PasswordStrength password={password} />
      <Button type="submit" size="lg" loading={signup.isPending} className="mt-2 w-full">
        Create account
      </Button>
      <p className="text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link
          href={
            next
              ? `/login?next=${encodeURIComponent(next)}${email ? `&email=${encodeURIComponent(email)}` : ""}`
              : "/login"
          }
          className="font-medium text-primary underline-offset-4 hover:underline"
        >
          Sign in
        </Link>
      </p>
    </form>
  );
}
