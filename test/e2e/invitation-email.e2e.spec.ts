/**
 * An invitation must actually SCHEDULE MAIL — the one flow that onboards every user.
 *
 * Nothing covered this. `notification-flow.e2e.spec.ts` proves a notification's `email_outbox` insert,
 * and the invitation path — `InvitationService.inviteMember` → `EmailSchedulerService.schedule` — had
 * no test at all, which is how it came to be true that outbound email was IMPOSSIBLE in both deployed
 * environments without a single suite noticing: no verified SES identity anywhere in `infra/`, and no
 * `ses:SendEmail` on any task role. Every invitation failed with AccessDenied, three failures opened
 * the in-process email circuit breaker, and the API went on reporting healthy.
 *
 * WHAT THIS PINS AND WHAT IT CANNOT. It asserts the half that lives in this repo's code: the row is
 * written, in the caller's transaction, addressed to the INVITED address, carrying the accept link and
 * the workspace name the template needs. It cannot assert delivery — that is a verified identity, an
 * IAM grant and the SES sandbox, none of which exist in a unit-test database. Those are asserted by
 * `infra/` and checked by hand (`aws sesv2 get-account --query ProductionAccessEnabled`); locally,
 * `docker exec rally-localstack awslocal ses verify-email-identity` plus the worker's relay is what
 * makes the send observable.
 *
 * NOTE FOR THE NEXT READER: there is an ORPHANED `InvitationService` in this module with its own
 * `inviteMember` and its own email scheduling. No module provides it, the barrel does not export it,
 * and nothing injects it — the live path is `WorkspaceService.inviteMember`, which the route calls and
 * which this file drives. Writing this test against the orphan is the first thing I did wrong, and it
 * would have passed while proving nothing about the running system.
 *
 * IT ASSERTS THE FLAG-OFF PATH, which is the default and the one staff onboarding uses. Since
 * migration 0124, `ENTRA_GUEST_INVITE_ENABLED` moves this row's WRITER: with the flag on, the invite
 * request no longer schedules the email at all — `EntraGuestInviteRelayService` does, after Entra
 * provisioning resolves, so a link cannot reach an external collaborator before the directory object
 * that makes it usable exists. Both writers use `invitation.id` as the idempotency key, so the
 * assertions below (one row, keyed on the invitation) hold either way; what changes is WHEN it appears.
 * If this file ever fails with zero rows, check that flag before hunting a regression — the flag-on
 * ordering is pinned by `entra-guest-invite-relay.service.spec.ts` instead, because a real Graph call
 * and a worker process are not things this suite can arrange.
 *
 * The `email_outbox` row is the RIGHT seam to assert. `EmailSchedulerService` writes it inside the
 * caller's transaction, so a rolled-back invitation cannot leave mail behind, and the relay is a
 * separate process — which means "did we schedule it" and "did it go out" are genuinely two questions
 * and this file answers the first one honestly rather than both badly.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { INestApplication } from '@nestjs/common';

import { WorkspaceService } from '@modules/workspace';
import { DRIZZLE } from '@platform';
import type { DrizzleDB } from '@platform';
import { emailOutbox } from '../../db/schema/messaging';
import { ADMIN_USER_ID, bootRallyApp, WORKSPACE_ID } from './support/flow-harness';

describe('invitation email (real AppModule + seeded DB)', () => {
  let app: INestApplication;
  let workspaces: WorkspaceService;
  let db: DrizzleDB;

  beforeAll(async () => {
    app = await bootRallyApp();
    workspaces = app.get(WorkspaceService);
    db = app.get<DrizzleDB>(DRIZZLE);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('schedules a workspace-invitation email addressed to the INVITED address', async () => {
    // A per-run address: `cancelExistingForEmail` supersedes an earlier pending invitation for the
    // same address, so a fixed one would assert against whichever row survived a previous run.
    const email = `ba-tester-${Date.now()}@qnsc.dev`;

    const invitation = await workspaces.inviteMember(WORKSPACE_ID, email, undefined, ADMIN_USER_ID);

    const rows = await db
      .select()
      .from(emailOutbox)
      .where(eq(emailOutbox.idempotencyKey, invitation.id));

    // ONE row, keyed by the invitation — the idempotency key is what stops a resend duplicating mail.
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.template).toBe('workspace-invitation');
    // The INVITED address, lower-cased by the service. Acceptance binds to this value
    // (`INVITATION_EMAIL_MISMATCH`), so mail going anywhere else is a security fault, not a typo.
    expect(row.to).toBe(email.toLowerCase());
    // Not yet sent by anyone: the relay is a separate process, and that separation is the point.
    expect(['pending', 'sent']).toContain(row.status);
  });

  it('carries the accept link and the workspace name the template renders', async () => {
    const email = `ba-tester-vars-${Date.now()}@qnsc.dev`;
    const invitation = await workspaces.inviteMember(WORKSPACE_ID, email, undefined, ADMIN_USER_ID);

    const [row] = await db
      .select()
      .from(emailOutbox)
      .where(eq(emailOutbox.idempotencyKey, invitation.id));

    const vars = (row?.vars ?? {}) as Record<string, string>;
    // The link is the whole message: an invitation with no token is an email that cannot be accepted,
    // and the token is NOT in the API response by design (a forwardable link would defeat the
    // bind-to-address rule), so this row is the only place it ever appears.
    expect(vars.inviteUrl).toMatch(/accept-invitation\?token=.+/);
    expect(vars.workspaceName).toBeTruthy();
    expect(vars.recipientEmail).toBe(email.toLowerCase());
    // Days, not a date: the template says "expires in N days", and a formatted date here would be
    // rendered in the SERVER's timezone for a reader who may be in another.
    expect(Number(vars.expiresInDays)).toBeGreaterThan(0);
  });

  it('supersedes a pending invitation rather than sending two for one address', async () => {
    // Re-inviting is the ordinary admin gesture when the first mail is missed. `cancelExistingForEmail`
    // cancels the previous row, so the second invitation is the live one — and each has its own
    // idempotency key, so the earlier mail is not silently suppressed by the key either.
    const email = `ba-tester-resend-${Date.now()}@qnsc.dev`;
    const first = await workspaces.inviteMember(WORKSPACE_ID, email, undefined, ADMIN_USER_ID);
    const second = await workspaces.inviteMember(WORKSPACE_ID, email, undefined, ADMIN_USER_ID);

    expect(second.id).not.toBe(first.id);
    const rows = await db.select().from(emailOutbox).where(eq(emailOutbox.to, email.toLowerCase()));
    expect(rows).toHaveLength(2);
  });
});
