CREATE TABLE "call_usage_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"call_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"billable_minutes" integer,
	"meter_event_identifier" text,
	"reported_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "call_usage_reports_call_id_unique" UNIQUE("call_id")
);
--> statement-breakpoint
ALTER TABLE "call_usage_reports" ADD CONSTRAINT "call_usage_reports_call_id_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."calls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_usage_reports" ADD CONSTRAINT "call_usage_reports_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "call_usage_reports_organization_id_idx" ON "call_usage_reports" USING btree ("organization_id");