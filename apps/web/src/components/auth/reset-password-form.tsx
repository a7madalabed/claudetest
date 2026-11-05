"use client";

import { PasswordSchema } from "@ledgerly/shared";
import { zodResolver } from "@hookform/resolvers/zod";
import { CheckCircle2 } from "lucide-react";
import Link from "next/link";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { PasswordInput } from "@/components/ui/password-input";
import { isApiError } from "@/lib/api/errors";
import { usePasswordReset } from "@/lib/query/hooks";
import { FormAlert } from "./form-alert";
import { PasswordStrength } from "./password-strength";

const FormSchema = z
  .object({ password: PasswordSchema, confirm: z.string() })
  .refine((v) => v.password === v.confirm, {
    message: "The passwords don't match",
    path: ["confirm"],
  });

/**
 * The token only gets used when the person submits a new password: email
 * security scanners that "click" every link can't burn it by opening the page.
 */
export function ResetPasswordForm({ token }: { token: string }) {
  const reset = usePasswordReset();
  const form = useForm<z.infer<typeof FormSchema>>({
    resolver: zodResolver(FormSchema),
    /*
     * Validate on SUBMIT, then live as they fix things. Validating when a field
     * loses focus put "Enter a valid email address" above the links below the
     * form the moment you clicked one: the link jumped 11 px mid-click, and the
     * click missed (found by the Stage 15 browser tests).
     */
    mode: "onSubmit",
    reValidateMode: "onChange",
    defaultValues: { password: "", confirm: "" },
  });
  const password = useWatch({ control: form.control, name: "password" });
  const { errors } = form.formState;

  if (reset.isSuccess) {
    return (
      <div role="status" className="grid gap-4">
        <CheckCircle2 className="size-8 text-positive" aria-hidden />
        <p>Your password has been changed, and every device was signed out.</p>
        <Button asChild size="lg">
          <Link href="/login">Sign in</Link>
        </Button>
      </div>
    );
  }

  const expired = isApiError(reset.error) && reset.error.code === "link_expired";
  // method="post": if this form is ever submitted before the app's JavaScript
  // takes over (a slow connection, a tab opened before a deploy), the browser
  // must not put the fields, a password among them, in the URL, where history
  // and access logs keep them (Stage 16).
  return (
    <form
      method="post"
      noValidate
      className="grid gap-4"
      onSubmit={form.handleSubmit(({ password }) =>
        reset.mutate(
          { token, password },
          {
            onError: (error) => {
              const message = isApiError(error) ? error.fieldError("password") : undefined;
              if (message) form.setError("password", { message }, { shouldFocus: true });
            },
          },
        ),
      )}
    >
      <FormAlert
        error={isApiError(reset.error) && reset.error.fieldErrors.length > 0 ? null : reset.error}
      />
      {expired && (
        <Link
          href="/forgot-password"
          className="text-sm font-medium text-primary underline-offset-4 hover:underline"
        >
          Send me a new link
        </Link>
      )}
      <Field label="New password" error={errors.password?.message}>
        <PasswordInput autoComplete="new-password" autoFocus {...form.register("password")} />
      </Field>
      <PasswordStrength password={password} />
      <Field label="Confirm new password" error={errors.confirm?.message}>
        <PasswordInput autoComplete="new-password" {...form.register("confirm")} />
      </Field>
      <Button type="submit" size="lg" loading={reset.isPending} className="mt-2 w-full">
        Set new password
      </Button>
    </form>
  );
}
