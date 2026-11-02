import { z } from "zod";

/**
 * All configuration comes from environment variables (the "12-factor app" rule),
 * and is validated ONCE at startup. If something is missing or malformed the
 * process refuses to start with a clear message, instead of crashing later at
 * 3 a.m. when the first request happens to touch the bad value.
 */
const booleanString = z.enum(["true", "false"]).transform((value) => value === "true");

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
     * 32 random bytes, base64-encoded, used to encrypt secrets at rest (TOTP secrets).
     * Generate one with:
     *   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
     */
    ENCRYPTION_KEY: z
      .base64()
      .transform((value) => Buffer.from(value, "base64"))
      .refine((key) => key.length === 32, "ENCRYPTION_KEY must decode to exactly 32 bytes"),
    /** Mark cookies `Secure` (sent over HTTPS only). Defaults to true in production. */
    COOKIE_SECURE: booleanString.optional(),
    /**
     * How many proxies in front of the API to trust for the client's real IP
     * (X-Forwarded-For). "false" = none (the socket address is the client),
     * a number = that many hops (e.g. 1 for the Next.js proxy, 2 for a load
     * balancer + Next.js), or a comma-separated list of trusted proxy IPs.
     * Trusting MORE hops than really exist lets clients forge their IP.
     */
    TRUST_PROXY: z
      .string()
      .default("false")
      .transform((value): boolean | string | ((address: string, hop: number) => boolean) => {
        if (value === "false" || value === "true") return value === "true";
        // "Trust the nearest N proxies" — hop 0 is the socket peer, hop 1 the next one…
        if (/^\d+$/.test(value)) return (_address, hop) => hop < Number(value);
        return value; // comma-separated IP list
      }),
    RATE_LIMIT_ENABLED: booleanString.default(true),
    /** Absolute session lifetime: users must sign in again after this, however active. */
    SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
    /** Idle timeout: a session unused for this long expires early. */
    SESSION_IDLE_DAYS: z.coerce.number().int().min(1).max(90).default(14),
    /** Serve /docs and /openapi.json. */
    API_DOCS: booleanString.default(true),
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
  .transform((env) => ({
    ...env,
    COOKIE_SECURE: env.COOKIE_SECURE ?? env.NODE_ENV === "production",
  }))
  // Cross-field rule: production must never send session cookies over plain HTTP.
  .refine((env) => !(env.NODE_ENV === "production" && !env.COOKIE_SECURE), {
    message: "COOKIE_SECURE must be true in production",
    path: ["COOKIE_SECURE"],
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
