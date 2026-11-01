import {
  ChangePasswordSchema,
  DisableTotpSchema,
  IdSchema,
  LoginResultSchema,
  LoginSchema,
  MeSchema,
  MfaCodeSchema,
  RecoveryCodesSchema,
  SessionSchema,
  SignupSchema,
  TotpSetupSchema,
} from "@ledgerly/shared";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { problems } from "../../lib/responses.js";
import { getMe } from "../households/households.service.js";
import * as auth from "./auth.service.js";
import * as sessions from "./sessions.service.js";

/**
 * /v1/auth — sign-up, sign-in, two-factor, sessions and password management.
 *
 * Every endpoint that accepts a secret (password or code) is RATE LIMITED, keyed
 * on what an attacker would vary: IP + email for sign-in (credential stuffing),
 * the session for 2FA codes (a 6-digit code has only 1,000,000 possibilities).
 */
export const authRoutes: FastifyPluginAsyncZod<{ encryptionKey: Buffer; ttlDays: number }> = async (
  app,
  opts,
) => {
  const tags = ["Auth"];
  const key = opts.encryptionKey;

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
      config: { rateLimit: { max: 5, timeWindow: "1 hour" } },
      schema: {
        tags,
        summary: "Create an account (and a first household), then sign in",
        security: [],
        body: SignupSchema,
        response: { 201: MeSchema, ...problems(400, 409, 422, 429) },
      },
    },
    async (request, reply) => {
      const userId = await app.db.transaction((tx) => auth.signup(tx, request.body));
      await startSession(request, reply, userId);
      request.log.info({ userId, event: "auth.signup" }, "User signed up");
      return reply.status(201).send(await getMe(app.db, userId));
    },
  );

  app.post(
    "/login",
    {
      config: {
        rateLimit: {
          max: 10,
          timeWindow: "15 minutes",
          // Runs after the body is parsed, so we can key on the email too.
          hook: "preHandler",
          keyGenerator: (request) =>
            `login:${request.ip}:${String((request.body as { email?: string } | undefined)?.email ?? "").toLowerCase()}`,
        },
      },
      schema: {
        tags,
        summary: "Sign in with email and password",
        security: [],
        body: LoginSchema,
        response: { 200: LoginResultSchema, ...problems(400, 401, 429) },
      },
    },
    async (request, reply) => {
      try {
        const { userId, mfaEnabled } = await auth.verifyCredentials(
          app.db,
          request.body.email,
          request.body.password,
        );
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
        rateLimit: {
          max: 5,
          timeWindow: "5 minutes",
          keyGenerator: (request) => `mfa:${request.cookies[app.sessionCookieName] ?? request.ip}`,
        },
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
      const method = await auth.verifySecondFactor(
        app.db,
        key,
        request.user!.id,
        request.body.code,
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
      config: { rateLimit: { max: 5, timeWindow: "15 minutes" } },
      schema: {
        tags,
        summary: "Change password (signs out all other devices)",
        body: ChangePasswordSchema,
        response: { 204: z.null(), ...problems(400, 401, 422, 429) },
      },
    },
    async (request, reply) => {
      await auth.changePassword(
        app.db,
        request.user!,
        request.body.currentPassword,
        request.body.newPassword,
      );
      // If the old password leaked, the attacker's sessions die with it.
      await sessions.revokeOtherSessions(app.db, request.user!.id, request.session!.id);
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
      config: { rateLimit: { max: 10, timeWindow: "15 minutes" } },
      schema: {
        tags,
        summary: "Confirm 2FA with a code; returns one-time recovery codes",
        body: MfaCodeSchema,
        response: { 200: RecoveryCodesSchema, ...problems(400, 401, 409, 429) },
      },
    },
    async (request) => {
      const recoveryCodes = await auth.confirmTotpSetup(
        app.db,
        key,
        request.user!.id,
        request.body.code,
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
      config: { rateLimit: { max: 5, timeWindow: "15 minutes" } },
      schema: {
        tags,
        summary: "Turn off 2FA (requires password and a current code)",
        body: DisableTotpSchema,
        response: { 204: z.null(), ...problems(400, 401, 422, 429) },
      },
    },
    async (request, reply) => {
      await auth.disableTotp(
        app.db,
        key,
        request.user!.id,
        request.body.password,
        request.body.code,
      );
      request.log.warn(
        { userId: request.user!.id, event: "auth.mfa_disabled" },
        "Two-factor disabled",
      );
      return reply.status(204).send(null);
    },
  );
};
