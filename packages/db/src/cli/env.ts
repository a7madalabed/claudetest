/** Shared helpers for the db:* command-line scripts. */
try {
  process.loadEnvFile();
} catch {
  // No .env file: fine, use real environment variables.
}

export function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("❌ DATABASE_URL is not set. Copy packages/db/.env.example to packages/db/.env");
    process.exit(1);
  }
  return url;
}

/**
 * Destructive scripts (reset, seed) must never run against production by accident.
 * They're allowed only against a database on this machine, unless explicitly overridden.
 */
export function assertSafeToWipe(url: string): void {
  const host = new URL(url).hostname;
  const isLocal = ["localhost", "127.0.0.1", "::1", "postgres"].includes(host);
  if (
    process.env.NODE_ENV === "production" ||
    (!isLocal && process.env.ALLOW_DESTRUCTIVE_DB !== "1")
  ) {
    console.error(
      `❌ Refusing to modify data on "${host}". This script is for local development only.`,
    );
    process.exit(1);
  }
}
