"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { LoginSchema, type LoginInput } from "@ledgerly/shared";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { PasswordInput } from "@/components/ui/password-input";
import { useLogin } from "@/lib/query/hooks";
import { FormAlert } from "./form-alert";

/**
 * Only allow redirects to our own pages (never `?next=https://evil.example`).
 *
 * Checking the text by hand is a trap: browsers read "/\evil.example" and
 * "/<tab>/evil.example" as "//evil.example", i.e. ANOTHER SITE (an open
 * redirect, found in the Stage 16 review). So let a real URL parser decide
 * where the link goes, exactly as the browser will, and keep it only if it
 * stays on our origin. The base is a placeholder: this runs on the server too.
 */
const OWN_ORIGIN = "https://ledgerly.invalid";

export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith("/")) return "/app";
  try {
    const url = new URL(next, OWN_ORIGIN);
    return url.origin === OWN_ORIGIN ? `${url.pathname}${url.search}${url.hash}` : "/app";
  } catch {
    return "/app";
  }
}

export function LoginForm({ next, email }: { next?: string; email?: string }) {
  const router = useRouter();
  const login = useLogin();
  const form = useForm<z.input<typeof LoginSchema>, unknown, LoginInput>({
    resolver: zodResolver(LoginSchema),
    /*
     * Validate on SUBMIT, then live as they fix things. Validating when a field
     * loses focus put "Enter a valid email address" above the links below the
     * form the moment you clicked one: the link jumped 11 px mid-click, and the
     * click missed (found by the Stage 15 browser tests).
     */
    mode: "onSubmit",
    reValidateMode: "onChange",
    // ?email= comes from an invitation link: the account it was sent to.
    defaultValues: { email: email ?? "", password: "" },
  });
  const { errors } = form.formState;

  const onSubmit = form.handleSubmit((values) =>
    login.mutate(values, {
      onSuccess: (result) => {
        if (result.status === "mfa_required") {
          router.push(`/login/verify?next=${encodeURIComponent(safeNext(next))}`);
        } else {
          router.replace(safeNext(next));
          router.refresh(); // re-run server components with the new session cookie
        }
      },
    }),
  );

  // method="post": if this form is ever submitted before the app's JavaScript
  // takes over (a slow connection, a tab opened before a deploy), the browser
  // must not put the fields, a password among them, in the URL, where history
  // and access logs keep them (Stage 16).
  return (
    <form method="post" onSubmit={onSubmit} noValidate className="grid gap-4">
      <FormAlert error={login.error} />
      <Field label="Email" error={errors.email?.message}>
        <Input
          type="email"
          autoComplete="email"
          autoFocus
          placeholder="you@example.com"
          {...form.register("email")}
        />
      </Field>
      <Field label="Password" error={errors.password?.message}>
        <PasswordInput autoComplete="current-password" {...form.register("password")} />
      </Field>
      <Link
        href="/forgot-password"
        className="-mt-2 justify-self-end text-sm font-medium text-primary underline-offset-4 hover:underline"
      >
        Forgot password?
      </Link>
      <Button type="submit" size="lg" loading={login.isPending} className="mt-2 w-full">
        Sign in
      </Button>
      <p className="text-center text-sm text-muted-foreground">
        New to Ledgerly?{" "}
        <Link
          href={
            next
              ? `/signup?next=${encodeURIComponent(next)}${email ? `&email=${encodeURIComponent(email)}` : ""}`
              : "/signup"
          }
          className="font-medium text-primary underline-offset-4 hover:underline"
        >
          Create an account
        </Link>
      </p>
    </form>
  );
}
