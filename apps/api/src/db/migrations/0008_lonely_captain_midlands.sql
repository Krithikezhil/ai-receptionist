CREATE TABLE "sms_notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"notification_type" text NOT NULL,
	"appointment_id" uuid,
	"lead_id" uuid,
	"destination_phone" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"provider_message_sid" text,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"claimed_at" timestamp with time zone,
	"last_attempted_at" timestamp with time zone,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sms_notifications_exactly_one_entity" CHECK (("sms_notifications"."appointment_id" IS NOT NULL) <> ("sms_notifications"."lead_id" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "sms_notifications" ADD CONSTRAINT "sms_notifications_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sms_notifications" ADD CONSTRAINT "sms_notifications_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sms_notifications" ADD CONSTRAINT "sms_notifications_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sms_notifications_organization_id_idx" ON "sms_notifications" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "sms_notifications_status_next_attempt_at_idx" ON "sms_notifications" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sms_notifications_type_appointment_id_idx" ON "sms_notifications" USING btree ("notification_type","appointment_id") WHERE "sms_notifications"."appointment_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "sms_notifications_type_lead_id_idx" ON "sms_notifications" USING btree ("notification_type","lead_id") WHERE "sms_notifications"."lead_id" IS NOT NULL;