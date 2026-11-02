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
import { createSession } from "../modules/auth/sessions.service.js";
import { API_TEST_DATABASE_URL } from "./database.js";

export const OWNER = "demo@ledgerly.app";
export const VIEWER = "viewer@example.com";
export const OUTSIDER = "outsider@example.com";

export interface Fixtures {
  householdId: string;
  otherHouseholdId: string;
  /** Session tokens by email, for sending authenticated requests. */
  tokens: Record<string, string>;
}

/** A fixed, valid test key. Real keys come from the environment and never live in code. */
export const TEST_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");

export const testEnv = (overrides: Record<string, string> = {}) =>
  loadEnv({
    NODE_ENV: "test",
    LOG_LEVEL: process.env.TEST_LOG_LEVEL ?? "silent",
    DATABASE_URL: API_TEST_DATABASE_URL,
    ENCRYPTION_KEY: TEST_ENCRYPTION_KEY,
    // Rate limits are tested in their own file; elsewhere they'd make tests order-dependent.
    RATE_LIMIT_ENABLED: "false",
    ...overrides,
  });

/** Every test file that sends cookies needs the cookie name the app uses. */
export const SESSION_COOKIE = "ledgerly_session";

/**
 * Sets up a fresh app + realistic data before EACH test:
 *  - the deterministic demo household (owner: demo@ledgerly.app)
 *  - a viewer in that household
 *  - an outsider with their own, separate household
 */
let currentTokens: Record<string, string> = {};

export function useTestApp(envOverrides: Record<string, string> = {}) {
  const database = createDb({ connectionString: API_TEST_DATABASE_URL, maxConnections: 4 });
  const ctx = {
    app: undefined as unknown as FastifyInstance,
    db: database.db as Database,
    fixtures: {} as Fixtures,
  };

  beforeAll(async () => {
    ctx.app = await buildApp(testEnv(envOverrides), { db: database.db, closeDb: database.close });
  });

  afterAll(() => ctx.app.close());

  beforeEach(async () => {
    await database.db.execute(
      sql`truncate table budget_amounts, budgets, goals, dashboard_layouts, recovery_codes, sessions, idempotency_keys, transactions, categories, accounts, household_members, households, users cascade`,
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

    // Sign each fixture user in by creating a session directly (fast, no hashing).
    const tokens: Record<string, string> = {};
    for (const [email, userId] of [
      [OWNER, demo.userId],
      [VIEWER, viewer!.id],
      [OUTSIDER, outsider!.id],
    ] as const) {
      const { token } = await createSession(database.db, {
        userId,
        ttlDays: 1,
        ipAddress: null,
        userAgent: "vitest",
      });
      tokens[email] = token;
    }

    ctx.fixtures = { householdId: demo.householdId, otherHouseholdId: other!.id, tokens };
    currentTokens = tokens;
  });

  return ctx;
}

/**
 * Fires an in-memory request as `user` (an email from the fixtures, or null for
 * anonymous). No network involved.
 */
export function request(
  app: FastifyInstance,
  user: string | null,
  options: InjectOptions,
): Promise<LightMyRequestResponse> {
  const token = user ? currentTokens[user] : undefined;
  return app.inject({
    ...options,
    ...(token && { cookies: { [SESSION_COOKIE]: token, ...options.cookies } }),
    ...(user &&
      !token && { cookies: { [SESSION_COOKIE]: "not-a-real-session", ...options.cookies } }),
  });
}
