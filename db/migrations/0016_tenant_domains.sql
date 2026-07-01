-- Migration: 0016_tenant_domains
-- Adds tenancy.tenant_domains — the enterprise "domain capture" registry that
-- binds a company email domain to a tenant. Once a domain is verified and
-- auto-join is enabled, new signups on that domain join the existing tenant
-- instead of fragmenting into separate tenants (prevents tenant sprawl).

CREATE TABLE IF NOT EXISTS "tenancy"."tenant_domains" (
  "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id"       uuid NOT NULL,
  "domain"          varchar(255) NOT NULL,
  "verified_at"     timestamptz,
  "allow_auto_join" boolean NOT NULL DEFAULT false,
  "created_at"      timestamptz NOT NULL DEFAULT now(),
  "updated_at"      timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "uq_tenant_domains_domain"
  ON "tenancy"."tenant_domains" ("domain");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "ix_tenant_domains_tenant"
  ON "tenancy"."tenant_domains" ("tenant_id");
