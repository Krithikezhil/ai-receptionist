CREATE TABLE "sms_opt_outs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"phone_number" text NOT NULL,
	"opted_out_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sms_opt_outs" ADD CONSTRAINT "sms_opt_outs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sms_opt_outs_organization_id_phone_number_idx" ON "sms_opt_outs" USING btree ("organization_id","phone_number");