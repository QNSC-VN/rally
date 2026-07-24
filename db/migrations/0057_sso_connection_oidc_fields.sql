CREATE TYPE "public"."sso_connection_kind" AS ENUM('directory', 'shared');--> statement-breakpoint
ALTER TABLE "identity"."sso_connections" ADD COLUMN "kind" "public"."sso_connection_kind" DEFAULT 'directory' NOT NULL;--> statement-breakpoint
ALTER TABLE "identity"."sso_connections" ADD COLUMN "authority_url" varchar(512);--> statement-breakpoint
ALTER TABLE "identity"."sso_connections" ADD COLUMN "jwks_uri" varchar(512);--> statement-breakpoint
ALTER TABLE "identity"."sso_connections" ADD COLUMN "accepted_issuers" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "identity"."sso_connections" ADD COLUMN "scopes" varchar(255) DEFAULT 'openid profile email' NOT NULL;--> statement-breakpoint
ALTER TABLE "identity"."sso_connections" ADD COLUMN "client_id" varchar(255);--> statement-breakpoint
ALTER TABLE "identity"."sso_connections" ADD COLUMN "client_secret_ref" varchar(512);--> statement-breakpoint
ALTER TABLE "identity"."sso_connections" ADD COLUMN "display_name" varchar(255);--> statement-breakpoint
CREATE TABLE "identity"."sso_connection_domains" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"domain" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_sso_connection_domains_domain" UNIQUE("domain")
);--> statement-breakpoint
ALTER TABLE "identity"."sso_connection_domains" ADD CONSTRAINT "sso_connection_domains_connection_id_sso_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "identity"."sso_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_sso_connection_domains_connection" ON "identity"."sso_connection_domains" USING btree ("connection_id");--> statement-breakpoint
-- Backfill owned domains for directory connections from the legacy jsonb allow-list
-- (lower-cased, de-duplicated by the UNIQUE(domain) constraint).
INSERT INTO "identity"."sso_connection_domains" ("connection_id", "domain")
SELECT c."id", lower(trim(d.domain))
FROM "identity"."sso_connections" c
CROSS JOIN LATERAL jsonb_array_elements_text(c."allowed_email_domains") AS d(domain)
WHERE c."kind" = 'directory' AND coalesce(trim(d.domain), '') <> ''
ON CONFLICT ("domain") DO NOTHING;
