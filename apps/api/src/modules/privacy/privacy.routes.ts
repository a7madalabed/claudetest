import { DeleteAccountSchema } from "@ledgerly/shared";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { problems } from "../../lib/responses.js";
import { clearAttempts, consumeAttempt, limits } from "../auth/throttle.js";
import { deleteAccount, exportData } from "./privacy.service.js";

/** /v1/me/export and DELETE /v1/me: take your data with you, and leave (Stage 15). */
export const privacyRoutes: FastifyPluginAsyncZod<{ encryptionKey: Buffer }> = async (
  app,
  opts,
) => {
  const tags = ["Privacy"];

  app.get(
    "/me/export",
    {
      onRequest: app.authenticate,
      schema: {
        tags,
        summary: "Download everything you can see, as JSON",
        response: { 200: z.record(z.string(), z.unknown()), ...problems(401, 429) },
      },
    },
    async (request, reply) => {
      await consumeAttempt(app.db, limits.dataExport(request.user!.id));
      const data = await exportData(app.db, request.user!.id);
      const day = data.exportedAt.slice(0, 10);
      request.log.info({ userId: request.user!.id, event: "privacy.export" }, "Data exported");
      return reply
        .header("content-disposition", `attachment; filename="ledgerly-export-${day}.json"`)
        .header("cache-control", "no-store")
        .send(data);
    },
  );

  app.delete(
    "/me",
    {
      onRequest: app.authenticate,
      schema: {
        tags,
        summary: "Delete your account (password, and a 2FA code if it's on)",
        body: DeleteAccountSchema,
        response: { 204: z.null(), ...problems(400, 401, 409, 422, 429) },
      },
    },
    async (request, reply) => {
      const attempt = limits.reauth(request.user!.id);
      await consumeAttempt(app.db, attempt);
      const { deletedHouseholds } = await deleteAccount(
        app.db,
        opts.encryptionKey,
        request.user!.id,
        request.body,
      );
      await clearAttempts(
        app.db,
        attempt.map((l) => l.key),
      );
      app.clearSessionCookie(reply);
      request.log.warn(
        { userId: request.user!.id, deletedHouseholds, event: "privacy.account_deleted" },
        "Account deleted",
      );
      return reply.status(204).send(null);
    },
  );
};
