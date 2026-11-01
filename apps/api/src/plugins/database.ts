import type { Database } from "@ledgerly/db";
import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";

declare module "fastify" {
  interface FastifyInstance {
    /** The Drizzle database, available in every route as `app.db` / `request.server.db`. */
    db: Database;
  }
}

/**
 * Makes the database available to all routes.
 *
 * The connection pool is created OUTSIDE the app (in server.ts) and passed in.
 * That's dependency injection: tests can pass a test database, and the app
 * doesn't need to know where its connections come from.
 *
 * `fastify-plugin` (fp) lifts the decoration to the root scope so every route
 * sees `app.db`, instead of only routes registered inside this plugin.
 */
interface DatabasePluginOptions {
  db: Database;
  close?: () => Promise<void>;
}

const plugin: FastifyPluginAsync<DatabasePluginOptions> = async (app, { db, close }) => {
  app.decorate("db", db);
  if (close) {
    // Runs during graceful shutdown, after in-flight requests have finished.
    app.addHook("onClose", async () => {
      app.log.info("Closing database pool");
      await close();
    });
  }
};

export const databasePlugin = fp(plugin, { name: "database" });
