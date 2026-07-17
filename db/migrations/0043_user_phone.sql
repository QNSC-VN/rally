-- 0043: Add an optional contact phone number to identity.users.
-- Nullable with no backfill — existing users simply have no phone until they
-- set one. Surfaced via GET/PATCH /auth/me and workspace member profiles.
ALTER TABLE "identity"."users" ADD COLUMN IF NOT EXISTS "phone" varchar(32);
