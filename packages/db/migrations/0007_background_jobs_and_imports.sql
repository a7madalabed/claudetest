CREATE TYPE "public"."import_status" AS ENUM('uploaded', 'queued', 'processing', 'completed', 'failed', 'reverted');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('queued', 'running', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."recurring_cadence" AS ENUM('weekly', 'twice_monthly', 'monthly');--> statement-breakpoint
CREATE TABLE "imports" (
	"id" uuid PRIMARY KEY NOT NULL,
	"household_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"created_by" uuid,
	"file_name" text NOT NULL,
	"file_size" integer NOT NULL,
	"file_text" text,
	"status" "import_status" DEFAULT 'uploaded' NOT NULL,
	"mapping" jsonb,
	"total_rows" integer DEFAULT 0 NOT NULL,
	"processed_rows" integer DEFAULT 0 NOT NULL,
	"imported_count" integer DEFAULT 0 NOT NULL,
	"duplicate_count" integer DEFAULT 0 NOT NULL,
	"error_count" integer DEFAULT 0 NOT NULL,
	"errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "imports_id_household_id_key" UNIQUE("id","household_id"),
	CONSTRAINT "imports_file_name_length" CHECK (char_length("imports"."file_name") between 1 and 255),
	CONSTRAINT "imports_counts_not_negative" CHECK ("imports"."total_rows" >= 0 and "imports"."processed_rows" >= 0 and "imports"."imported_count" >= 0 and "imports"."duplicate_count" >= 0 and "imports"."error_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "job_schedules" (
	"name" text PRIMARY KEY NOT NULL,
	"interval_seconds" integer NOT NULL,
	"next_run_at" timestamp with time zone NOT NULL,
	"last_run_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "job_status" DEFAULT 'queued' NOT NULL,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer,
	"locked_until" timestamp with time zone,
	"locked_by" text,
	"last_error" text,
	"singleton_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "jobs_attempts" CHECK ("jobs"."attempts" >= 0 and ("jobs"."max_attempts" is null or "jobs"."max_attempts" between 1 and 25))
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"household_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"link" text,
	"dedupe_key" text NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recurring_rules" (
	"id" uuid PRIMARY KEY NOT NULL,
	"household_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"category_id" uuid,
	"description" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"cadence" "recurring_cadence" NOT NULL,
	"anchor_day" smallint,
	"second_day" smallint,
	"next_date" date NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"series_key" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recurring_rules_amount_not_zero" CHECK ("recurring_rules"."amount_minor" <> 0),
	CONSTRAINT "recurring_rules_description_length" CHECK (char_length("recurring_rules"."description") between 1 and 200),
	CONSTRAINT "recurring_rules_days" CHECK (("recurring_rules"."cadence" = 'weekly' and "recurring_rules"."anchor_day" is null and "recurring_rules"."second_day" is null)
       or ("recurring_rules"."cadence" = 'monthly' and "recurring_rules"."anchor_day" between 1 and 31 and "recurring_rules"."second_day" is null)
       or ("recurring_rules"."cadence" = 'twice_monthly' and "recurring_rules"."anchor_day" between 1 and 31 and "recurring_rules"."second_day" between 1 and 31 and "recurring_rules"."anchor_day" < "recurring_rules"."second_day"))
);
--> statement-breakpoint
ALTER TABLE "households" ADD COLUMN "time_zone" text DEFAULT 'UTC' NOT NULL;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "import_id" uuid;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "import_fingerprint" text;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "recurring_rule_id" uuid;--> statement-breakpoint
ALTER TABLE "imports" ADD CONSTRAINT "imports_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imports" ADD CONSTRAINT "imports_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imports" ADD CONSTRAINT "imports_account_fkey" FOREIGN KEY ("account_id","household_id") REFERENCES "public"."accounts"("id","household_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_rules" ADD CONSTRAINT "recurring_rules_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_rules" ADD CONSTRAINT "recurring_rules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_rules" ADD CONSTRAINT "recurring_rules_account_fkey" FOREIGN KEY ("account_id","household_id") REFERENCES "public"."accounts"("id","household_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_rules" ADD CONSTRAINT "recurring_rules_category_fkey" FOREIGN KEY ("category_id","household_id") REFERENCES "public"."categories"("id","household_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "imports_household_created_idx" ON "imports" USING btree ("household_id","created_at");--> statement-breakpoint
CREATE INDEX "jobs_ready_idx" ON "jobs" USING btree ("run_at") WHERE "jobs"."status" = 'queued';--> statement-breakpoint
CREATE INDEX "jobs_running_lease_idx" ON "jobs" USING btree ("locked_until") WHERE "jobs"."status" = 'running';--> statement-breakpoint
CREATE INDEX "jobs_finished_idx" ON "jobs" USING btree ("finished_at") WHERE "jobs"."status" in ('succeeded', 'failed');--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_singleton_key" ON "jobs" USING btree ("singleton_key") WHERE "jobs"."status" = 'queued';--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_user_dedupe_key" ON "notifications" USING btree ("user_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "notifications_user_created_idx" ON "notifications" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "notifications_user_unread_idx" ON "notifications" USING btree ("user_id") WHERE "notifications"."read_at" is null;--> statement-breakpoint
CREATE INDEX "recurring_rules_due_idx" ON "recurring_rules" USING btree ("next_date") WHERE "recurring_rules"."active";--> statement-breakpoint
CREATE UNIQUE INDEX "recurring_rules_household_series_key" ON "recurring_rules" USING btree ("household_id","series_key") WHERE "recurring_rules"."series_key" is not null;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_recurring_rule_id_recurring_rules_id_fk" FOREIGN KEY ("recurring_rule_id") REFERENCES "public"."recurring_rules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_import_fkey" FOREIGN KEY ("import_id","household_id") REFERENCES "public"."imports"("id","household_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "transactions_import_idx" ON "transactions" USING btree ("import_id") WHERE "transactions"."import_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "transactions_account_import_fingerprint_key" ON "transactions" USING btree ("account_id","import_fingerprint") WHERE "transactions"."import_fingerprint" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "transactions_recurring_occurrence_key" ON "transactions" USING btree ("recurring_rule_id","occurred_on") WHERE "transactions"."recurring_rule_id" is not null;