-- The invitation EMAIL is now scheduled by the guest-provisioning relay, not by the invite request,
-- so the relay needs the one thing the invitation row cannot give it: the RAW invite token.
--
-- WHY THE ORDER MOVED. `WorkspaceService.inviteMember` wrote two outbox rows in one transaction and
-- two independent relays drained them: the email relay runs every 5s AND is woken immediately by
-- `wakeEmailRelay`, while the guest relay ran on a 30s cron with no wake signal. So the invitee got
-- their link in under a second and their Entra guest object up to 30s later, plus Microsoft's own
-- directory replication. An invited external who clicks immediately — which people do — has no
-- object in our tenant yet and cannot authenticate at all: `NO_CONNECTION` from our login box, or
-- `AADSTS50020` from Microsoft's. Intermittent, and indistinguishable from the feature being broken.
--
-- The fix is ordering, not tuning: while `ENTRA_GUEST_INVITE_ENABLED` is ON the email is scheduled by
-- whoever KNOWS the guest is ready — the relay, in the same transaction that marks the row `sent` and
-- writes `entra_guest_object_id`. A link therefore cannot precede the account that makes it usable.
-- Flag OFF is unchanged: no row is enqueued and `inviteMember` schedules the email inline, so staff
-- onboarding behaves exactly as it did before migration 0123 existed.
--
-- WHY THE RAW TOKEN HAS TO BE HERE. `inviteUrl` embeds the raw token and only its sha256 is
-- persisted (`workspace_invitations.token_hash`, `mintInviteToken`), so the relay cannot rebuild the
-- link from the invitation. The alternative considered was scheduling the email at invite time with a
-- future `scheduled_at` and having the relay pull it forward; that was rejected because it does not
-- establish the ordering at all — the row is already committed to sending, so a permanent Graph
-- refusal needs an explicit cancel write (miss it and the invitee gets a dead link), and a relay that
-- is merely slow still sends early, which is the same race with a longer fuse.
--
-- SECURITY ASSESSMENT, stated rather than implied. This is a bearer credential in a second table:
--   - It is the SAME credential `messaging.email_outbox.vars->>'inviteUrl'` already stores in
--     cleartext for every invitation ever sent, so the blast radius does not widen — it is one more
--     row in the same schema, reachable by exactly the same principal (the app's DB role).
--   - No route reads or projects this table; the only readers are the worker relay and a human with
--     database access.
--   - It is SCRUBBED as soon as it can no longer be needed: the relay NULLs it in the same write that
--     schedules the email, and on a terminal failure (where no email will ever be built from it).
--     A row therefore holds a live token only for the seconds between enqueue and the Graph call.
--   - The token is single-use and expires with the invitation (`INVITATION_TTL_DAYS`), and acceptance
--     is bound to the invited address (`INVITATION_EMAIL_MISMATCH`), so a leaked one is not a
--     transferable capability.
--
-- NULL means "this row owes no email", which is a real state and not just the pre-migration default:
-- `resendInvitation` re-enqueues provisioning under the same `invitation.id` key to recover an
-- invitation sent while the flag was off, and it has ALREADY emailed its own freshly-rotated token
-- inline. Passing no token there is what stops one resend producing two emails.
ALTER TABLE messaging.guest_invite_outbox
  ADD COLUMN IF NOT EXISTS invite_token VARCHAR(255);

COMMENT ON COLUMN messaging.guest_invite_outbox.invite_token IS
  'RAW (unhashed) invitation token, so the relay can build inviteUrl for the email it schedules '
  'after provisioning resolves. NULLed by the relay once the email is scheduled or the row fails '
  'terminally; NULL also means "this row owes no email" (see migration 0124).';
