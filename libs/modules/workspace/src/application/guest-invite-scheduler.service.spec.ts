/**
 * GuestInviteSchedulerService — the API half of Entra B2B guest provisioning.
 *
 * Three properties carry the design: the row is written on the CALLER'S transaction handle (so it
 * cannot outlive a rolled-back invitation), NOTHING is written while `ENTRA_GUEST_INVITE_ENABLED` is
 * off (so an invitation cannot break because the tenant has not granted `User.Invite.All` yet), and
 * a row that owes the invitation EMAIL carries the raw token the relay needs to build it — the
 * ordering that stops a link reaching an invitee who has no directory object yet (migration 0124).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GuestInviteSchedulerService } from './guest-invite-scheduler.service';
import type { DbExecutor } from '@platform';
import { guestInviteOutbox } from '../../../../../db/schema/messaging';

/** Records the drizzle insert chain so a test can assert on values + conflict target. */
function makeTx() {
  const onConflictDoNothing = vi.fn().mockResolvedValue(undefined);
  const values = vi.fn(() => ({ onConflictDoNothing }));
  const insert = vi.fn(() => ({ values }));
  return { tx: { insert } as unknown as DbExecutor, insert, values, onConflictDoNothing };
}

function makeConfig(enabled: boolean) {
  return {
    get: vi.fn((key: string) => (key === 'ENTRA_GUEST_INVITE_ENABLED' ? enabled : undefined)),
  };
}

/** The wake publisher. Best-effort in production, so a rejection must never surface. */
function makePubSub(wake: () => Promise<void> = () => Promise.resolve()) {
  return { wakeGuestInviteRelay: vi.fn(wake) };
}

type Ctor = ConstructorParameters<typeof GuestInviteSchedulerService>;

function build(enabled: boolean, pubSub = makePubSub()) {
  const service = new GuestInviteSchedulerService(
    makeConfig(enabled) as unknown as Ctor[0],
    pubSub as unknown as Ctor[1],
  );
  return { service, pubSub };
}

const options = {
  invitationId: 'inv-1',
  workspaceId: 'ws-1',
  email: 'external@partner.example',
};

describe('GuestInviteSchedulerService', () => {
  let tx: ReturnType<typeof makeTx>;

  beforeEach(() => {
    tx = makeTx();
  });

  describe('ENTRA_GUEST_INVITE_ENABLED off (the default)', () => {
    it('writes NOTHING and reports that it did not enqueue', async () => {
      // Load-bearing: the app registration needs `User.Invite.All` with admin consent first, and
      // until it lands every Graph call is a 403. Queuing rows guaranteed to dead-letter would page
      // an alarm for every invitation sent in the meantime.
      const { service, pubSub } = build(false);

      await expect(service.schedule(tx.tx, options)).resolves.toBe(false);
      expect(tx.insert).not.toHaveBeenCalled();
      // Nothing was queued, so nothing to wake — and `inviteMember` reads that `false` to decide it
      // must send the invitation email itself.
      expect(pubSub.wakeGuestInviteRelay).not.toHaveBeenCalled();
    });
  });

  describe('ENTRA_GUEST_INVITE_ENABLED on', () => {
    let service: GuestInviteSchedulerService;
    let pubSub: ReturnType<typeof makePubSub>;

    beforeEach(() => {
      ({ service, pubSub } = build(true));
    });

    it('inserts one pending row on the caller-supplied transaction handle', async () => {
      await expect(service.schedule(tx.tx, options)).resolves.toBe(true);

      // The handle the caller passed, not a service-owned connection: a standalone write would be
      // exactly the dual-write this seam exists to avoid.
      expect(tx.insert).toHaveBeenCalledWith(guestInviteOutbox);
      expect(tx.values).toHaveBeenCalledWith({
        invitationId: 'inv-1',
        workspaceId: 'ws-1',
        email: 'external@partner.example',
        displayName: null,
        status: 'pending',
        idempotencyKey: 'inv-1',
        inviteToken: null,
      });
    });

    it('carries the RAW invite token when the row owes the email, and NULL when it does not', async () => {
      // The relay cannot rebuild `inviteUrl` from the invitation: only the sha256 is persisted. A
      // row with no token owes no email — that is how `resendInvitation`, which mails its own rotated
      // token inline, avoids sending one invitation twice.
      await service.schedule(tx.tx, { ...options, inviteToken: 'raw-token-abc' });
      expect(tx.values).toHaveBeenCalledWith(
        expect.objectContaining({ inviteToken: 'raw-token-abc' }),
      );

      await service.schedule(tx.tx, options);
      expect(tx.values).toHaveBeenLastCalledWith(expect.objectContaining({ inviteToken: null }));
    });

    it('wakes the worker relay, because the invitation email now waits on it', async () => {
      await service.schedule(tx.tx, { ...options, inviteToken: 'raw-token-abc' });
      expect(pubSub.wakeGuestInviteRelay).toHaveBeenCalledOnce();
    });

    it('survives a wake that rejects — the cron is the fallback', async () => {
      // Best-effort, exactly as `EmailSchedulerService`: Valkey being unreachable must not fail an
      // invitation whose rows are already written.
      const failing = makePubSub(() => Promise.reject(new Error('valkey down')));
      const { service: svc } = build(true, failing);

      await expect(svc.schedule(tx.tx, options)).resolves.toBe(true);
      expect(tx.insert).toHaveBeenCalledOnce();
    });

    it('keys deduplication on the invitation id and swallows a duplicate', async () => {
      // A retried invite request must not produce two Graph invitations — unlike a duplicate email,
      // a duplicate here would be a second directory write.
      await service.schedule(tx.tx, options);

      expect(tx.onConflictDoNothing).toHaveBeenCalledWith({
        target: guestInviteOutbox.idempotencyKey,
      });
    });

    it('passes a supplied display name through, and NULL when there is none', async () => {
      await service.schedule(tx.tx, { ...options, displayName: 'Dana Partner' });
      expect(tx.values).toHaveBeenCalledWith(
        expect.objectContaining({ displayName: 'Dana Partner' }),
      );

      await service.schedule(tx.tx, { ...options, displayName: null });
      expect(tx.values).toHaveBeenLastCalledWith(expect.objectContaining({ displayName: null }));
    });
  });
});
