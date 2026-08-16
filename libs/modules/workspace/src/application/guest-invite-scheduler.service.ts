/**
 * GuestInviteSchedulerService — writes the Entra B2B guest-provisioning intent into
 * `messaging.guest_invite_outbox`, in the CALLER'S transaction.
 *
 * Modelled on `EmailSchedulerService` (`libs/platform/src/email/email-scheduler.service.ts`), whose
 * docblock states the seam: the row is written in the same transaction as the business data, so if
 * the transaction rolls back the job rolls back with it, and there is no dual-write. That is
 * exactly the property this needs — a provisioning intent for an invitation that was never created
 * would provision a directory guest for nobody, and an invitation created without its intent would
 * produce a collaborator who cannot sign in at all.
 *
 * Deliberately NOT the Graph call itself. `entity-attachments.service.ts:106-110` states this
 * repo's rule for that shape ("holding a Postgres transaction open across a network round-trip … is
 * worse than the gap it would close"), and a fire-and-forget call after commit is no better: its
 * failure surfaces only as the invitee's login being refused as `AUTH_TOKEN_INVALID`, which names
 * nothing. `apps/worker/src/identity/entra-guest-invite-relay.service.ts` owns the call.
 *
 * The transaction handle is REQUIRED, unlike `EmailSchedulerService`'s optional one. There is no
 * best-effort mode worth having: the only caller is inside `inviteMember`'s transaction, and a
 * standalone write would be the dual-write this class exists to avoid.
 *
 * IT ALSO CARRIES THE INVITATION EMAIL'S ORDERING (migration 0124). When a row is enqueued it takes
 * the raw invite token, and the relay schedules the email once provisioning has resolved — so the
 * link never reaches the invitee before the directory object that makes it usable exists. When the
 * flag is off nothing is enqueued, `schedule` answers `false`, and `inviteMember` emails inline as it
 * always did.
 */
import { Injectable, Logger } from '@nestjs/common';
import { AppConfigService } from '@platform';
import type { DbExecutor } from '@platform';
import { NotificationPubSubService } from '@platform/notifications';
import { guestInviteOutbox } from '../../../../../db/schema/messaging';

export interface ScheduleGuestInviteOptions {
  /** The invitation this intent belongs to. Also the idempotency key — see below. */
  invitationId: string;
  workspaceId: string;
  /** Already normalised (lowercased, trimmed) by the caller. */
  email: string;
  /** Graph's optional `invitedUserDisplayName`. */
  displayName?: string | null;
  /**
   * The RAW invitation token, when THIS row owes the invitation email (migration 0124).
   *
   * Supplied by `inviteMember`, which no longer schedules the email itself while the flag is on: the
   * relay schedules it after provisioning resolves, so the link cannot reach the invitee before the
   * directory object that makes it usable exists. Omitted by `resendInvitation`, which emails its
   * own freshly-rotated token inline — passing it here would send the same invitation twice.
   */
  inviteToken?: string | null;
}

@Injectable()
export class GuestInviteSchedulerService {
  private readonly logger = new Logger(GuestInviteSchedulerService.name);

  constructor(
    private readonly config: AppConfigService,
    private readonly pubSub: NotificationPubSubService,
  ) {}

  /**
   * Enqueue guest provisioning for one invitation. Returns whether a row was enqueued — the caller
   * BRANCHES ON IT, so this is not just for the spec: `false` means the invite email has to be
   * scheduled inline, because no relay pass will ever schedule it.
   *
   * FLAG OFF WRITES NOTHING. `ENTRA_GUEST_INVITE_ENABLED` defaults to false because the app
   * registration needs the `User.Invite.All` application permission with admin consent first, and
   * until it lands every Graph call is a 403. Queuing rows that are guaranteed to dead-letter would
   * make every invitation sent in the meantime page an alarm; skipping the row leaves
   * `inviteMember` behaving exactly as it did before this existed.
   *
   * Note the return value is about the FLAG, not about the insert taking effect: a duplicate is
   * swallowed by `ON CONFLICT DO NOTHING` and still answers `true`. That is deliberate for the one
   * caller that can hit a duplicate — `resendInvitation`, which emails inline regardless — and it is
   * why `inviteMember`'s own retry is safe: the email is keyed on `invitation.id` in BOTH paths, so
   * whichever writer gets there first, exactly one email exists.
   */
  async schedule(tx: DbExecutor, options: ScheduleGuestInviteOptions): Promise<boolean> {
    if (this.config.get('ENTRA_GUEST_INVITE_ENABLED') !== true) return false;

    await tx
      .insert(guestInviteOutbox)
      .values({
        invitationId: options.invitationId,
        workspaceId: options.workspaceId,
        email: options.email,
        displayName: options.displayName ?? null,
        status: 'pending',
        // Only when this row owes the email. The relay NULLs it as soon as it has been used, and a
        // row that owes nothing never carries a credential at all — see migration 0124.
        inviteToken: options.inviteToken ?? null,
        // `invitation.id`, the same convention `email_outbox` uses for `workspace-invitation`. A
        // retried invite request therefore cannot enqueue two Graph invitations for one
        // invitation — and unlike the email, a duplicate here would be a second directory write.
        idempotencyKey: options.invitationId,
      })
      // Silently swallowed inside the caller's transaction, exactly as `EmailSchedulerService`
      // does: the intent is already recorded, so a second call is a no-op and not an error.
      .onConflictDoNothing({ target: guestInviteOutbox.idempotencyKey });

    /**
     * Wake the worker relay, exactly as `EmailSchedulerService` does after an email_outbox insert
     * and for the same reason — except the reason is now stronger: while the flag is on, THIS relay
     * is what schedules the invitation email, so its cron cadence is latency the invitee feels.
     *
     * Best-effort and fired before the caller's transaction commits, which is the same small race
     * `wakeEmailRelay` has: a woken pass may not see the uncommitted row, and the cron picks it up.
     */
    this.pubSub.wakeGuestInviteRelay().catch(() => {
      /* cron fallback handles it */
    });

    this.logger.debug(
      { invitationId: options.invitationId, owesEmail: !!options.inviteToken },
      'Entra guest provisioning enqueued with the invitation',
    );
    return true;
  }
}
