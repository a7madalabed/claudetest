-- Keep updated_at accurate on the new tables (same trigger function as migration 0001).
CREATE TRIGGER imports_set_updated_at BEFORE UPDATE ON imports
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER recurring_rules_set_updated_at BEFORE UPDATE ON recurring_rules
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER jobs_set_updated_at BEFORE UPDATE ON jobs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint

-- Whenever transactions change — through the API, a CSV import, a recurring rule
-- or a manual fix in psql — queue ONE "budgets.evaluate" job per affected
-- household, for the household's CURRENT month only (old months never alert).
--
-- * FOR EACH STATEMENT with transition tables: an import inserting 500 rows
--   fires this once, not 500 times.
-- * singleton_key + ON CONFLICT DO NOTHING: while a job for that household and
--   month is still queued, more changes don't add more jobs (debouncing).
-- * run_at = now() + 2 s: a burst of edits settles before we evaluate.
-- * It runs INSIDE the transaction that changed the data: if that rolls back,
--   so does the job.
CREATE FUNCTION enqueue_budget_evaluation() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  affected jsonb;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT jsonb_agg(DISTINCT jsonb_build_object('h', household_id, 'm', date_trunc('month', occurred_on)::date))
      INTO affected FROM new_rows;
  ELSIF TG_OP = 'DELETE' THEN
    SELECT jsonb_agg(DISTINCT jsonb_build_object('h', household_id, 'm', date_trunc('month', occurred_on)::date))
      INTO affected FROM old_rows;
  ELSE
    SELECT jsonb_agg(DISTINCT jsonb_build_object('h', household_id, 'm', date_trunc('month', occurred_on)::date))
      INTO affected
      FROM (SELECT household_id, occurred_on FROM new_rows
            UNION ALL
            SELECT household_id, occurred_on FROM old_rows) AS changed;
  END IF;

  INSERT INTO jobs (name, payload, singleton_key, run_at)
  SELECT 'budgets.evaluate',
         jsonb_build_object('householdId', a->>'h', 'month', to_char((a->>'m')::date, 'YYYY-MM')),
         'budgets.evaluate:' || (a->>'h') || ':' || to_char((a->>'m')::date, 'YYYY-MM'),
         now() + interval '2 seconds'
  FROM jsonb_array_elements(coalesce(affected, '[]'::jsonb)) AS a
  JOIN households h ON h.id = (a->>'h')::uuid
  WHERE (a->>'m')::date = date_trunc('month', now() AT TIME ZONE h.time_zone)::date
  ON CONFLICT (singleton_key) WHERE status = 'queued' DO NOTHING;

  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER transactions_budget_evaluation_insert AFTER INSERT ON transactions
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION enqueue_budget_evaluation();
--> statement-breakpoint
CREATE TRIGGER transactions_budget_evaluation_update AFTER UPDATE ON transactions
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION enqueue_budget_evaluation();
--> statement-breakpoint
CREATE TRIGGER transactions_budget_evaluation_delete AFTER DELETE ON transactions
  REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION enqueue_budget_evaluation();
