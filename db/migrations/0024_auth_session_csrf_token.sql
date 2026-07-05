-- Add csrf_token column to auth_sessions for double-submit cookie CSRF protection.
-- Nullable: existing sessions lack a token and are treated as pre-migration
-- (refresh is allowed but a new csrf_token is minted for the rotated session).

ALTER TABLE "identity"."auth_sessions"
  ADD COLUMN "csrf_token" varchar(64);
