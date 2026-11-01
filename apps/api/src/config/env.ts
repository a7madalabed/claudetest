import { z } from "zod";

/**
 * All configuration comes from environment variables (the "12-factor app" rule),
 * and is validated ONCE at startup. If something is missing or malformed the
 * process refuses to start with a clear message, instead of crashing later at
 * 3 a.m. when the first request happens to touch the bad value.
 */
const EnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    HOST: z.string().default("0.0.0.0"),
    PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
      .default("info"),
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
    /**
     * How requests are authenticated. "dev" trusts an x-dev-user-email header and
     * exists only until Stage 5 adds real sign-in.
     */
    AUTH_MODE: z.enum(["dev"]).default("dev"),
    /** Serve /docs and /openapi.json. */
    API_DOCS: z
      .enum(["true", "false"])
      .default("true")
      .transform((value) => value === "true"),
    CORS_ORIGINS: z
      .string()
      .default("http://localhost:3000")
      .transform((value) =>
        value
          .split(",")
          .map((origin) => origin.trim())
          .filter(Boolean),
      ),
  })
  // Cross-field rule: development auth must never run in production.
  .refine((env) => !(env.NODE_ENV === "production" && env.AUTH_MODE === "dev"), {
    message: "AUTH_MODE=dev is not allowed when NODE_ENV=production",
    path: ["AUTH_MODE"],
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
