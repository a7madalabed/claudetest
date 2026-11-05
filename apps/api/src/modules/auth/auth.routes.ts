import {
  ChangePasswordSchema,
  DisableTotpSchema,
  IdSchema,
  LoginResultSchema,
  LoginSchema,
  MeSchema,
  MfaCodeSchema,
  PasswordResetRequestSchema,
  PasswordResetSchema,
  RecoveryCodesSchema,
  SessionSchema,
  SignupSchema,
  TotpSetupSchema,
  VerifyEmailSchema,
} from "@ledgerly/shared";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { enqueue } from "../../jobs/queue.js";
import { conflict } from "../../lib/errors.js";
import { problems } from "../../lib/responses.js";
import { getMe } from "../households/households.service.js";
import * as account from "./account.service.js";
import * as auth from "./auth.service.js";
import * as sessions from "./sessions.service.js";
import {
  clearAccountLoginAttempts,
  clearAttempts,
  consumeAttempt as consumeAttemptIn,
  limits,
  type Limit,
} from "./throttle.js";

/**
 * /v1/auth — sign-up, sign-in, two-factor, sessions and password management.
 *
 * Every endpoint that accepts a secret (password or code) is ATTEMPT-LIMITED,
 * with counters in the database (./throttle.ts, Stage 15): they survive deploys,
 * are shared by every API instance, and can't be raced with parallel guesses.
 */
export const authRoutes: FastifyPluginAsyncZod<{
  encryptionKey: Buffer;
  ttlDays: number;
  /** Per-address volume limits (RATE_LIMIT_ENABLED). Per-account limits always apply. */
  ipLimits: boolean;
}> = async (app, opts) => {
  const tags = ["Auth"];
  const key = opts.encryptionKey;
  const consumeAttempt = (db: typeof app.db, limits: Limit[]) =>
    consumeAttemptIn(db, limits, { ipLimits: opts.ipLimits });

  const meta = (request: FastifyRequest) => ({
    ipAddress: request.ip,
    userAgent: request.headers["user-agent"] ?? null,
  });

  async function startSession(
    request: FastifyRequest,
    reply: FastifyReply,
    userId: string,
    mfaPending = false,
  ) {
    const { token, session } = await sessions.createSession(app.db, {
      userId,
      mfaPending,
      ttlDays: opts.ttlDays,
      ...meta(request),
    });
    app.setSessionCookie(reply, token, session.expiresAt);
    return session;
  }

  app.post(
    "/signup",
    {
      schema: {
        tags,
        summary: "Create an account (and a first household), then sign in",
        security: [],
        body: SignupSchema,
        response: { 201: MeSchema, ...problems(400, 409, 422, 429) },
      },
    },
    async (request, reply) => {
      await consumeAttempt(app.db, limits.signup(request.ip));
      const userId = await app.db.transaction(async (tx) => {
        const id = await auth.signup(tx, request.body);
        // Same transaction: the email goes out only if the account really exists.
        await account.sendVerificationEmail(tx, key, { id, email: request.body.email });
        return id;
      });
      await startSession(request, reply, userId);
      request.log.info({ userId, event: "auth.signup" }, "User signed up");
      return reply.status(201).send(await getMe(app.db, userId));
    },
  );

  app.post(
    "/login",
    {
      schema: {
        tags,
        summary: "Sign in with email and password",
        security: [],
        body: LoginSchema,
        response: { 200: LoginResultSchema, ...problems(400, 401, 429) },
      },
    },
    async (request, reply) => {
      const attempt = limits.login(request.ip, request.body.email);
      await consumeAttempt(app.db, attempt);
      try {
        const { userId, mfaEnabled } = await auth.verifyCredentials(
          app.db,
          request.body.email,
          request.body.password,
        );
        // The password was right: forget this account's failed attempts. (The
        // per-IP counter stays: it measures volume from one address.)
        await clearAttempts(app.db, [attempt[0]!.key, attempt[1]!.key]);
        if (mfaEnabled) {
          await startSession(request, reply, userId, true);
          return {
            status: "mfa_required" as const,
            message: "Enter the 6-digit code from your authenticator app.",
          };
        }
        await startSession(request, reply, userId);
        request.log.info({ userId, event: "auth.login" }, "User signed in");
        return { status: "authenticated" as const, user: await getMe(app.db, userId) };
      } catch (error) {
        // Security events are logged (without the password!) so attacks are visible.
        request.log.warn({ event: "auth.login_failed", ip: request.ip }, "Failed sign-in attempt");
        throw error;
      }
    },
  );

  app.post(
    "/login/mfa",
    {
      onRequest: app.authenticate,
      config: {
        allowMfaPending: true,
      },
      schema: {
        tags,
        summary: "Complete sign-in with a 2FA or recovery code",
        body: MfaCodeSchema,
        response: { 200: LoginResultSchema, ...problems(400, 401, 429) },
      },
    },
    async (request, reply) => {
      const pending = request.session!;
      if (!pending.mfaPending) {
        return { status: "authenticated" as const, user: await getMe(app.db, request.user!.id) };
      }
      // Per ACCOUNT, not per pending session: a new sign-in must not buy new guesses.
      const attempt = limits.secondFactor(request.user!.id);
      await consumeAttempt(app.db, attempt);
      const method = await auth.verifySecondFactor(
        app.db,
        key,
        request.user!.id,
        request.body.code,
      );
      await clearAttempts(
        app.db,
        attempt.map((l) => l.key),
      );
      // Privilege changed → issue a brand-new session token and drop the pending one.
      await sessions.deleteSession(app.db, pending.id);
      await startSession(request, reply, request.user!.id);
      request.log.info(
        { userId: request.user!.id, event: "auth.mfa_verified", method },
        "Second factor verified",
      );
      return { status: "authenticated" as const, user: await getMe(app.db, request.user!.id) };
    },
  );

  app.post(
    "/logout",
    {
      onRequest: app.authenticate,
      config: { allowMfaPending: true },
      schema: {
        tags,
        summary: "Sign out this device",
        response: { 204: z.null(), ...problems(401) },
      },
    },
    async (request, reply) => {
      await sessions.deleteSession(app.db, request.session!.id);
      app.clearSessionCookie(reply);
      return reply.status(204).send(null);
    },
  );

  app.get(
    "/sessions",
    {
      onRequest: app.authenticate,
      schema: {
        tags,
        summary: "Devices where you're signed in",
        response: { 200: z.object({ data: z.array(SessionSchema) }), ...problems(401) },
      },
    },
    async (request) => ({
      data: await sessions.listSessions(app.db, request.user!.id, request.session!.id),
    }),
  );

  app.delete(
    "/sessions/:sessionId",
    {
      onRequest: app.authenticate,
      schema: {
        tags,
        summary: "Sign out one device",
        params: z.object({ sessionId: IdSchema }),
        response: { 204: z.null(), ...problems(401, 404) },
      },
    },
    async (request, reply) => {
      await sessions.revokeSession(app.db, request.user!.id, request.params.sessionId);
      if (request.params.sessionId === request.session!.id) app.clearSessionCookie(reply);
      return reply.status(204).send(null);
    },
  );

  app.post(
    "/sessions/revoke-others",
    {
      onRequest: app.authenticate,
      schema: {
        tags,
        summary: "Sign out everywhere else",
        response: { 204: z.null(), ...problems(401) },
      },
    },
    async (request, reply) => {
      await sessions.revokeOtherSessions(app.db, request.user!.id, request.session!.id);
      return reply.status(204).send(null);
    },
  );

  app.post(
    "/password",
    {
      onRequest: app.authenticate,
      schema: {
        tags,
        summary: "Change password (signs out all other devices)",
        body: ChangePasswordSchema,
        response: { 204: z.null(), ...problems(400, 401, 422, 429) },
      },
    },
    async (request, reply) => {
      const attempt = limits.reauth(request.user!.id);
      await consumeAttempt(app.db, attempt);
      await auth.changePassword(
        app.db,
        request.user!,
        request.body.currentPassword,
        request.body.newPassword,
      );
      await clearAttempts(
        app.db,
        attempt.map((l) => l.key),
      );
      // If the old password leaked, the attacker's sessions die with it.
      await sessions.revokeOtherSessions(app.db, request.user!.id, request.session!.id);
      // And the owner hears about it, in case it wasn't them.
      await enqueue(app.db, "account.email", {
        userId: request.user!.id,
        kind: "password_changed",
      });
      request.log.info(
        { userId: request.user!.id, event: "auth.password_changed" },
        "Password changed",
      );
      return reply.status(204).send(null);
    },
  );

  app.post(
    "/mfa/totp/setup",
    {
      onRequest: app.authenticate,
      schema: {
        tags,
        summary: "Start 2FA setup: returns a secret / QR code URI",
        response: { 200: TotpSetupSchema, ...problems(401, 409) },
      },
    },
    async (request) => auth.startTotpSetup(app.db, key, request.user!),
  );

  app.post(
    "/mfa/totp/enable",
    {
      onRequest: app.authenticate,
      schema: {
        tags,
        summary: "Confirm 2FA with a code; returns one-time recovery codes",
        body: MfaCodeSchema,
        response: { 200: RecoveryCodesSchema, ...problems(400, 401, 409, 429) },
      },
    },
    async (request) => {
      const attempt = limits.secondFactor(request.user!.id);
      await consumeAttempt(app.db, attempt);
      const recoveryCodes = await auth.confirmTotpSetup(
        app.db,
        key,
        request.user!.id,
        request.body.code,
      );
      await clearAttempts(
        app.db,
        attempt.map((l) => l.key),
      );
      request.log.info(
        { userId: request.user!.id, event: "auth.mfa_enabled" },
        "Two-factor enabled",
      );
      return { recoveryCodes };
    },
  );

  app.post(
    "/mfa/totp/disable",
    {
      onRequest: app.authenticate,
      schema: {
        tags,
        summary: "Turn off 2FA (requires password and a current code)",
        body: DisableTotpSchema,
        response: { 204: z.null(), ...problems(400, 401, 422, 429) },
      },
    },
    async (request, reply) => {
      const attempt = limits.reauth(request.user!.id);
      await consumeAttempt(app.db, attempt);
      await auth.disableTotp(
        app.db,
        key,
        request.user!.id,
        request.body.password,
        request.body.code,
      );
      await clearAttempts(
        app.db,
        attempt.map((l) => l.key),
      );
      request.log.warn(
        { userId: request.user!.id, event: "auth.mfa_disabled" },
        "Two-factor disabled",
      );
      return reply.status(204).send(null);
    },
  );

  // ─── Recovery and verification (Stage 15) ──────────────────────────────────

  app.post(
    "/password-reset/request",
    {
      schema: {
        tags,
        summary: "Email a password-reset link (same answer whether or not the account exists)",
        security: [],
        body: PasswordResetRequestSchema,
        response: { 202: z.null(), ...problems(400, 429) },
      },
    },
    async (request, reply) => {
      await consumeAttempt(app.db, limits.passwordResetRequest(request.ip, request.body.email));
      await account.requestPasswordReset(app.db, key, request.body.email);
      request.log.info({ event: "auth.password_reset_requested" }, "Password reset requested");
      return reply.status(202).send(null);
    },
  );

  app.post(
    "/password-reset",
    {
      schema: {
        tags,
        summary: "Set a new password with a link from the reset email (signs out every device)",
        security: [],
        body: PasswordResetSchema,
        response: { 204: z.null(), ...problems(400, 410, 422) },
      },
    },
    async (request, reply) => {
      const user = await account.resetPassword(app.db, request.body.token, request.body.password);
      // The real owner just proved themselves: lift any lockout on the account.
      await clearAccountLoginAttempts(app.db, user.email);
      request.log.info({ userId: user.id, event: "auth.password_reset" }, "Password reset");
      return reply.status(204).send(null);
    },
  );

  app.post(
    "/verify-email",
    {
      schema: {
        tags,
        summary: "Confirm the email address with the link we sent",
        security: [],
        body: VerifyEmailSchema,
        response: { 204: z.null(), ...problems(400, 410) },
      },
    },
    async (request, reply) => {
      const userId = await account.verifyEmail(app.db, request.body.token);
      request.log.info({ userId, event: "auth.email_verified" }, "Email verified");
      return reply.status(204).send(null);
    },
  );

  app.post(
    "/verify-email/resend",
    {
      onRequest: app.authenticate,
      schema: {
        tags,
        summary: "Send the confirmation email again",
        response: { 202: z.null(), ...problems(401, 409, 429) },
      },
    },
    async (request, reply) => {
      const me = await getMe(app.db, request.user!.id);
      if (me.emailVerified) throw conflict("already_verified", "Your email is already confirmed.");
      await consumeAttempt(app.db, limits.verificationEmail(request.user!.id));
      await app.db.transaction((tx) =>
        account.sendVerificationEmail(tx, key, { id: me.id, email: me.email }),
      );
      return reply.status(202).send(null);
    },
  );
};
