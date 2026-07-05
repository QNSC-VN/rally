-- Align auth_sessions.sso_provider and sso_identities.provider to use the
-- existing sso_provider enum type (already used by sso_connections.provider).

ALTER TABLE "identity"."auth_sessions"
  ALTER COLUMN "sso_provider" TYPE "public"."sso_provider"
  USING "sso_provider"::"public"."sso_provider";

ALTER TABLE "identity"."sso_identities"
  ALTER COLUMN "provider" TYPE "public"."sso_provider"
  USING "provider"::"public"."sso_provider";
