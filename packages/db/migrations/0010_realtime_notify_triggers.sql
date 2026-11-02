-- Real-time change feed (Stage 11).
--
-- After any write to household data, tell listeners WHAT changed and WHERE —
-- never the data itself. The API forwards these tiny messages to browsers over
-- Server-Sent Events, and each browser refetches what it's showing.
--
-- * pg_notify is TRANSACTIONAL: messages are delivered only on COMMIT (a rolled
--   back change is never announced), and identical messages sent in the same
--   transaction are delivered once.
-- * FOR EACH STATEMENT + transition tables: one message per household per
--   statement, even when an import inserts 500 rows at once.
-- * Payloads must stay under 8,000 bytes, which is why they carry ids, not rows.

CREATE FUNCTION notify_household_change() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  r record;
BEGIN
  IF TG_OP = 'DELETE' THEN
    FOR r IN SELECT household_id AS h, count(*) AS n FROM old_rows GROUP BY household_id LOOP
      PERFORM pg_notify('ledgerly_events',
        json_build_object('t', TG_TABLE_NAME, 'op', 'delete', 'h', r.h, 'n', r.n)::text);
    END LOOP;
  ELSE
    FOR r IN SELECT household_id AS h, count(*) AS n FROM new_rows GROUP BY household_id LOOP
      PERFORM pg_notify('ledgerly_events',
        json_build_object('t', TG_TABLE_NAME, 'op', lower(TG_OP), 'h', r.h, 'n', r.n)::text);
    END LOOP;
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint

-- Transactions also say WHO made them, so other members can see "Jamie added 2 transactions".
CREATE FUNCTION notify_transaction_change() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  r record;
BEGIN
  IF TG_OP = 'DELETE' THEN
    FOR r IN SELECT household_id AS h, count(*) AS n FROM old_rows GROUP BY household_id LOOP
      PERFORM pg_notify('ledgerly_events',
        json_build_object('t', 'transactions', 'op', 'delete', 'h', r.h, 'n', r.n)::text);
    END LOOP;
  ELSE
    FOR r IN
      SELECT household_id AS h, count(*) AS n,
             coalesce(json_agg(DISTINCT created_by) FILTER (WHERE created_by IS NOT NULL), '[]') AS a
      FROM new_rows GROUP BY household_id
    LOOP
      PERFORM pg_notify('ledgerly_events',
        json_build_object('t', 'transactions', 'op', lower(TG_OP), 'h', r.h, 'n', r.n, 'a', r.a)::text);
    END LOOP;
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint

-- Membership changes name the affected users: a removed member's browser must
-- learn it lost access, even though it no longer belongs to the household.
CREATE FUNCTION notify_membership_change() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT household_id AS h, json_agg(DISTINCT user_id) AS u
    FROM (SELECT household_id, user_id FROM new_rows
          UNION ALL
          SELECT household_id, user_id FROM old_rows) AS changed
    GROUP BY household_id
  LOOP
    PERFORM pg_notify('ledgerly_events',
      json_build_object('t', 'household_members', 'op', lower(TG_OP), 'h', r.h, 'u', r.u)::text);
  END LOOP;
  RETURN NULL;
END;
$$;
--> statement-breakpoint

-- Notifications belong to a USER, not a household.
CREATE FUNCTION notify_new_notifications() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT DISTINCT user_id AS u FROM new_rows LOOP
    PERFORM pg_notify('ledgerly_events', json_build_object('t', 'notifications', 'u', r.u)::text);
  END LOOP;
  RETURN NULL;
END;
$$;
--> statement-breakpoint

-- A household row's own id is its household id.
CREATE FUNCTION notify_household_row_change() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT id AS h FROM new_rows LOOP
    PERFORM pg_notify('ledgerly_events',
      json_build_object('t', 'households', 'op', 'update', 'h', r.h)::text);
  END LOOP;
  RETURN NULL;
END;
$$;
--> statement-breakpoint

-- Statement-level triggers with transition tables need one trigger per event.
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['accounts', 'categories', 'budgets', 'goals', 'recurring_rules', 'imports', 'household_invitations'] LOOP
    EXECUTE format('CREATE TRIGGER %I AFTER INSERT ON %I REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_household_change()', tbl || '_notify_insert', tbl);
    EXECUTE format('CREATE TRIGGER %I AFTER UPDATE ON %I REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_household_change()', tbl || '_notify_update', tbl);
    EXECUTE format('CREATE TRIGGER %I AFTER DELETE ON %I REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_household_change()', tbl || '_notify_delete', tbl);
  END LOOP;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER transactions_notify_insert AFTER INSERT ON transactions
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_transaction_change();
--> statement-breakpoint
CREATE TRIGGER transactions_notify_update AFTER UPDATE ON transactions
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_transaction_change();
--> statement-breakpoint
CREATE TRIGGER transactions_notify_delete AFTER DELETE ON transactions
  REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_transaction_change();
--> statement-breakpoint
-- Membership: the function reads BOTH transition tables, so each trigger declares both
-- (an INSERT trigger can't have an OLD TABLE, hence three different shapes).
CREATE FUNCTION notify_membership_insert() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE r record;
BEGIN
  FOR r IN SELECT household_id AS h, json_agg(DISTINCT user_id) AS u FROM new_rows GROUP BY household_id LOOP
    PERFORM pg_notify('ledgerly_events', json_build_object('t', 'household_members', 'op', 'insert', 'h', r.h, 'u', r.u)::text);
  END LOOP;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION notify_membership_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE r record;
BEGIN
  FOR r IN SELECT household_id AS h, json_agg(DISTINCT user_id) AS u FROM old_rows GROUP BY household_id LOOP
    PERFORM pg_notify('ledgerly_events', json_build_object('t', 'household_members', 'op', 'delete', 'h', r.h, 'u', r.u)::text);
  END LOOP;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER household_members_notify_insert AFTER INSERT ON household_members
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_membership_insert();
--> statement-breakpoint
CREATE TRIGGER household_members_notify_update AFTER UPDATE ON household_members
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_membership_change();
--> statement-breakpoint
CREATE TRIGGER household_members_notify_delete AFTER DELETE ON household_members
  REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_membership_delete();
--> statement-breakpoint
CREATE TRIGGER notifications_notify_insert AFTER INSERT ON notifications
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_new_notifications();
--> statement-breakpoint
CREATE TRIGGER households_notify_update AFTER UPDATE ON households
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_household_row_change();
