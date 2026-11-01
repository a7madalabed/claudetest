import { runMigrations } from "../migrate.js";
import { requireDatabaseUrl } from "./env.js";

const started = Date.now();
await runMigrations(requireDatabaseUrl());
console.log(`✅ Migrations applied in ${Date.now() - started} ms`);
