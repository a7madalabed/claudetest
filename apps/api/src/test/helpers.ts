import {
  createDb,
  householdMembers,
  households,
  seedDemoData,
  sql,
  users,
  type Database,
} from "@ledgerly/db";
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from "fastify";
import { afterAll, beforeAll, beforeEach } from "vitest";
import { buildApp } from "../app.js";
import { loadEnv } from "../config/env.js";
import { DEV_USER_HEADER } from "../plugins/auth.js";
import { API_TEST_DATABASE_URL } from "./database.js";

export const OWNER = "demo@ledgerly.app";
export const VIEWER = "viewer@example.com";
export const OUTSIDER = "outsider@example.com";

export interface Fixtures {
  householdId: string;
  otherHouseholdId: string;
}

/**
 * Sets up a fresh app + realistic data before EACH test:
 *  - the deterministic demo household (owner: demo@ledgerly.app)
 *  - a viewer in that household
 *  - an outsider with their own, separate household
 */
export function useTestApp() {
  const database = createDb({ connectionString: API_TEST_DATABASE_URL, maxConnections: 4 });
  const ctx = {
    app: undefined as unknown as FastifyInstance,
    db: database.db as Database,
    fixtures: {} as Fixtures,
  };

  beforeAll(async () => {
    const env = loadEnv({
      NODE_ENV: "test",
      LOG_LEVEL: process.env.TEST_LOG_LEVEL ?? "silent",
      DATABASE_URL: API_TEST_DATABASE_URL,
    });
    ctx.app = await buildApp(env, { db: database.db, closeDb: database.close });
  });

  afterAll(() => ctx.app.close());

  beforeEach(async () => {
    await database.db.execute(
      sql`truncate table idempotency_keys, transactions, categories, accounts, household_members, households, users cascade`,
    );
    const demo = await seedDemoData(database.db, { today: "2026-06-15", seed: 1 });

    const [viewer, outsider] = await database.db
      .insert(users)
      .values([
        { email: VIEWER, displayName: "Vee Viewer" },
        { email: OUTSIDER, displayName: "Otto Outsider" },
      ])
      .returning();
    const [other] = await database.db
      .insert(households)
      .values({ name: "Otto's Household" })
      .returning();
    await database.db.insert(householdMembers).values([
      { householdId: demo.householdId, userId: viewer!.id, role: "viewer" },
      { householdId: other!.id, userId: outsider!.id, role: "owner" },
    ]);

    ctx.fixtures = { householdId: demo.householdId, otherHouseholdId: other!.id };
  });

  return ctx;
}

/** Fires an in-memory request as `user` (no network involved). */
export function request(
  app: FastifyInstance,
  user: string | null,
  options: InjectOptions,
): Promise<LightMyRequestResponse> {
  return app.inject({
    ...options,
    headers: { ...(user ? { [DEV_USER_HEADER]: user } : {}), ...options.headers },
  });
}
