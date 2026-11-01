CREATE TYPE "public"."account_type" AS ENUM('checking', 'savings', 'credit_card', 'cash', 'investment', 'loan');--> statement-breakpoint
CREATE TYPE "public"."category_kind" AS ENUM('income', 'expense');--> statement-breakpoint
CREATE TYPE "public"."household_role" AS ENUM('owner', 'editor', 'viewer');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"household_id" uuid NOT NULL,
	"name" text NOT NULL,
	"type" "account_type" NOT NULL,
	"currency" char(3) NOT NULL,
	"opening_balance_minor" bigint DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounts_household_id_name_key" UNIQUE("household_id","name"),
	CONSTRAINT "accounts_id_household_id_key" UNIQUE("id","household_id"),
	CONSTRAINT "accounts_currency_iso4217" CHECK ("currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "accounts_name_length" CHECK (char_length("accounts"."name") between 1 and 100)
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY NOT NULL,
	"household_id" uuid NOT NULL,
	"parent_id" uuid,
	"name" text NOT NULL,
	"kind" "category_kind" NOT NULL,
	"icon" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "categories_id_household_id_key" UNIQUE("id","household_id"),
	CONSTRAINT "categories_household_parent_name_key" UNIQUE NULLS NOT DISTINCT("household_id","parent_id","name"),
	CONSTRAINT "categories_not_own_parent" CHECK ("categories"."parent_id" <> "categories"."id"),
	CONSTRAINT "categories_name_length" CHECK (char_length("categories"."name") between 1 and 50)
);
--> statement-breakpoint
CREATE TABLE "household_members" (
	"household_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "household_role" DEFAULT 'viewer' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "household_members_pkey" PRIMARY KEY("household_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "households" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"base_currency" char(3) DEFAULT 'USD' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "households_base_currency_iso4217" CHECK ("base_currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "households_name_length" CHECK (char_length("households"."name") between 1 and 100)
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"household_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"category_id" uuid,
	"amount_minor" bigint NOT NULL,
	"occurred_on" date NOT NULL,
	"description" text NOT NULL,
	"notes" text,
	"transfer_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transactions_amount_not_zero" CHECK ("transactions"."amount_minor" <> 0),
	CONSTRAINT "transactions_transfer_has_no_category" CHECK ("transactions"."transfer_id" is null or "transactions"."category_id" is null),
	CONSTRAINT "transactions_description_length" CHECK (char_length("transactions"."description") between 1 and 200)
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"display_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_shape" CHECK ("users"."email" ~ '^[^@\s]+@[^@\s]+$'),
	CONSTRAINT "users_display_name_length" CHECK (char_length("users"."display_name") between 1 and 100)
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_fkey" FOREIGN KEY ("parent_id","household_id") REFERENCES "public"."categories"("id","household_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_members" ADD CONSTRAINT "household_members_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_members" ADD CONSTRAINT "household_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_account_fkey" FOREIGN KEY ("account_id","household_id") REFERENCES "public"."accounts"("id","household_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_category_fkey" FOREIGN KEY ("category_id","household_id") REFERENCES "public"."categories"("id","household_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "household_members_user_id_idx" ON "household_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "transactions_household_occurred_idx" ON "transactions" USING btree ("household_id","occurred_on","id");--> statement-breakpoint
CREATE INDEX "transactions_account_occurred_idx" ON "transactions" USING btree ("account_id","occurred_on");--> statement-breakpoint
CREATE INDEX "transactions_transfer_idx" ON "transactions" USING btree ("transfer_id") WHERE "transactions"."transfer_id" is not null;--> statement-breakpoint
CREATE INDEX "transactions_category_idx" ON "transactions" USING btree ("category_id") WHERE "transactions"."category_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_lower_key" ON "users" USING btree (lower("email"));