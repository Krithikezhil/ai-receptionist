CREATE TABLE "stripe_webhook_events" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"stripe_subscription_id" text NOT NULL,
	"organization_id" uuid,
	"stripe_created_at" timestamp with time zone NOT NULL,
	"applied" boolean DEFAULT false NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "stripe_webhook_events" ADD CONSTRAINT "stripe_webhook_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stripe_webhook_events_subscription_created_idx" ON "stripe_webhook_events" USING btree ("stripe_subscription_id","stripe_created_at");--> statement-breakpoint
CREATE INDEX "stripe_webhook_events_organization_id_idx" ON "stripe_webhook_events" USING btree ("organization_id");