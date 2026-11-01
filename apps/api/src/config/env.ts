import { z } from "zod";

/**
 * All configuration comes from environment variables (the "12-factor app" rule),
 * and is validated ONCE at startup. If something is missing or malformed the
 * process refuses to start with a clear message, instead of crashing later at
 * 3 a.m. when the first request happens to touch the bad value.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  CORS_ORIGINS: z
    .string()
    .default("http://localhost:3000")
    .transform((value) =>
      value
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = EnvSchema.safeParse(source);
  if (!result.success) {
    // eslint-disable-next-line no-console -- the logger doesn't exist yet at this point
    console.error("❌ Invalid environment variables:\n" + z.prettifyError(result.error));
    throw new Error("Invalid environment configuration");
  }
  return result.data;
}
