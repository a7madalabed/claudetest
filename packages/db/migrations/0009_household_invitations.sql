CREATE TABLE "household_invitations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"household_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" "household_role" NOT NULL,
	"token_hash" text NOT NULL,
	"invited_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"accepted_by" uuid,
	"declined_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "household_invitations_role" CHECK ("household_invitations"."role" in ('editor', 'viewer'))
);
--> statement-breakpoint
ALTER TABLE "household_invitations" ADD CONSTRAINT "household_invitations_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_invitations" ADD CONSTRAINT "household_invitations_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_invitations" ADD CONSTRAINT "household_invitations_accepted_by_users_id_fk" FOREIGN KEY ("accepted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "household_invitations_token_hash_key" ON "household_invitations" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "household_invitations_open_email_key" ON "household_invitations" USING btree ("household_id",lower("email")) WHERE "household_invitations"."accepted_at" is null and "household_invitations"."declined_at" is null and "household_invitations"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX "household_invitations_household_idx" ON "household_invitations" USING btree ("household_id");