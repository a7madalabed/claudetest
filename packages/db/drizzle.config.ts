import { defineConfig } from "drizzle-kit";

try {
  process.loadEnvFile();
} catch {
  // No .env file — rely on real environment variables.
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./migrations",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://ledgerly:ledgerly@localhost:5432/ledgerly",
  },
  // Fail loudly instead of guessing when a migration could lose data.
  strict: true,
  verbose: true,
});
