CREATE TABLE "knowledge_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"category" text DEFAULT 'custom' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "receptionist_configurations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"display_name" text DEFAULT 'AI Receptionist' NOT NULL,
	"greeting" text DEFAULT 'Thank you for calling. How can I help you today?' NOT NULL,
	"tone" text DEFAULT 'friendly and professional' NOT NULL,
	"instructions" text DEFAULT '' NOT NULL,
	"fallback_message" text DEFAULT 'I''m sorry, I don''t have that information right now. Let me have someone follow up with you.' NOT NULL,
	"after_hours_message" text DEFAULT 'Thanks for calling. We''re currently closed — please leave a message and we''ll get back to you.' NOT NULL,
	"call_transfer_enabled" boolean DEFAULT false NOT NULL,
	"call_transfer_phone" text,
	"language" text DEFAULT 'en' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "receptionist_configurations_organization_id_unique" UNIQUE("organization_id")
);
--> statement-breakpoint
ALTER TABLE "knowledge_entries" ADD CONSTRAINT "knowledge_entries_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receptionist_configurations" ADD CONSTRAINT "receptionist_configurations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;