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

/** Only allow redirects to our own pages (never `?next=https://evil.example`). */
export function safeNext(next: string | null | undefined): string {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/app";
}

export function LoginForm({ next, email }: { next?: string; email?: string }) {
  const router = useRouter();
  const login = useLogin();
  const form = useForm<z.input<typeof LoginSchema>, unknown, LoginInput>({
    resolver: zodResolver(LoginSchema),
    mode: "onTouched",
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

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-4">
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
