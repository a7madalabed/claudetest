-- Executed by the official Postgres image the first time the volume is created.
-- Integration tests wipe their database, so they get their own.
CREATE DATABASE ledgerly_test OWNER ledgerly;
-- The API's integration tests get their own, so both suites can run in parallel.
CREATE DATABASE ledgerly_api_test OWNER ledgerly;
-- Stage 12: a separate database for the large performance dataset (tools/perf).
CREATE DATABASE ledgerly_perf OWNER ledgerly;
\connect ledgerly_perf
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
