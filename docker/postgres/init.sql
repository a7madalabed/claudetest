-- Executed by the official Postgres image the first time the volume is created.
-- Integration tests wipe their database, so they get their own.
CREATE DATABASE ledgerly_test OWNER ledgerly;
