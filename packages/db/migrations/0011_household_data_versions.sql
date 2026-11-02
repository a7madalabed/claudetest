CREATE TABLE "household_data_versions" (
	"household_id" uuid PRIMARY KEY NOT NULL,
	"version" bigint DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "household_data_versions" ADD CONSTRAINT "household_data_versions_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;