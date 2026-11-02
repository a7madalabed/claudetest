import { MarkNotificationsReadSchema, NotificationListSchema } from "@ledgerly/shared";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { problems } from "../../lib/responses.js";
import * as service from "./notifications.service.js";

/** A user's own notifications, across all their households. */
export const notificationRoutes: FastifyPluginAsyncZod = async (app) => {
  const tags = ["Notifications"];

  app.get(
    "/notifications",
    {
      onRequest: app.authenticate,
      schema: {
        tags,
        summary: "Your latest notifications and how many are unread",
        response: { 200: NotificationListSchema, ...problems(401) },
      },
    },
    async (request) => service.listNotifications(app.db, request.user!.id),
  );

  app.post(
    "/notifications/read",
    {
      onRequest: app.authenticate,
      schema: {
        tags,
        summary: "Mark some (or all) of your notifications as read",
        body: MarkNotificationsReadSchema,
        response: { 200: NotificationListSchema, ...problems(400, 401) },
      },
    },
    async (request) => {
      await service.markRead(app.db, request.user!.id, request.body.ids);
      return service.listNotifications(app.db, request.user!.id);
    },
  );
};
