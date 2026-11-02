-- Stage 12: bump a household's data version whenever its financial data changes.
-- The API keys cached responses (and ETags) by this version.
--
-- Statement-level, like the change feed: an import's 500-row insert bumps the
-- version once. The upsert takes a row lock on the household's version row, so
-- concurrent writes in ONE household queue briefly here — acceptable for a
-- household-sized group, and it makes the version strictly increasing.

CREATE OR REPLACE FUNCTION bump_household_version() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- Only households that still EXIST: deleting a household cascades to its
  -- transactions, firing this trigger for a household that's already gone
  -- (bumping it would violate the foreign key — a test caught this).
  IF TG_OP = 'DELETE' THEN
    INSERT INTO household_data_versions (household_id, version)
    SELECT DISTINCT o.household_id, 1 FROM old_rows o
    WHERE EXISTS (SELECT 1 FROM households h WHERE h.id = o.household_id)
    ON CONFLICT (household_id) DO UPDATE SET version = household_data_versions.version + 1;
  ELSE
    INSERT INTO household_data_versions (household_id, version)
    SELECT DISTINCT n.household_id, 1 FROM new_rows n
    WHERE EXISTS (SELECT 1 FROM households h WHERE h.id = n.household_id)
    ON CONFLICT (household_id) DO UPDATE SET version = household_data_versions.version + 1;
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['transactions', 'accounts', 'categories', 'budgets', 'goals', 'recurring_rules'] LOOP
    EXECUTE format('CREATE TRIGGER %I AFTER INSERT ON %I REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION bump_household_version()', tbl || '_version_insert', tbl);
    EXECUTE format('CREATE TRIGGER %I AFTER UPDATE ON %I REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION bump_household_version()', tbl || '_version_update', tbl);
    EXECUTE format('CREATE TRIGGER %I AFTER DELETE ON %I REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION bump_household_version()', tbl || '_version_delete', tbl);
  END LOOP;
END;
$$;
--> statement-breakpoint
-- Households that already exist start at version 1.
INSERT INTO household_data_versions (household_id) SELECT id FROM households ON CONFLICT DO NOTHING;
