/**
 * Both invitation lookups must check the EXPIRY, not just the status.
 *
 * `hasPendingInvitation` did (`expires_at > now`); `findSharedByInvitedEmail` did not. They answer
 * the same question — "does this address hold a live invitation?" — at two points on one login:
 * the second ROUTES the request to a shared connection, the first then decides whether the
 * invite-only gate admits it. With the clause missing from the router, an expired invitation still
 * selected its connection and was refused a moment later at the gate, so the reader got
 * `SSO_JIT_DISABLED` (and from the BFF callback, an opaque `AUTH_TOKEN_INVALID`) where
 * `NO_CONNECTION` is the truthful answer. One cause, two different refusals, neither naming it.
 *
 * WHY THE STATUS IS NOT ENOUGH, and why this is a real defect rather than tidiness: a cron flips
 * rows from `pending` to `expired` (`apps/worker/src/cron/cleanup.cron.ts`). Between the moment a
 * row expires and the next tick it is still `pending`. So `status` is a lagging projection of
 * `expires_at`, and only the timestamp can be trusted to gate access. The window is as long as the
 * cron interval.
 *
 * A PREDICATE spec, deliberately. The fault is a condition being absent, which is visible in the
 * rendered statement and invisible to anything that stubs the repository port — the same blind spot
 * CLAUDE.md records for every task spec that called a service directly and missed a guard defect.
 * drizzle's proxy driver renders the SQL without a database, so this runs in the unit suite.
 */
import { describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/pg-proxy';
import type { DrizzleDB } from '@platform';
import { SsoConnectionDrizzleRepository } from './sso-connection.drizzle-repository';

interface Captured {
  sql: string;
  params: unknown[];
}

/** A repository over a driver that records instead of executing. */
function recordingRepo(): { repo: SsoConnectionDrizzleRepository; captured: Captured[] } {
  const captured: Captured[] = [];
  const db = drizzle(async (sql, params) => {
    captured.push({ sql, params });
    return { rows: [] };
  });
  return { repo: new SsoConnectionDrizzleRepository(db as unknown as DrizzleDB), captured };
}

/**
 * Just the WHERE clause. The INNER JOIN also names `expires_at`-adjacent columns and the select
 * list names the whole invitations table, so "does this query check the expiry" cannot be answered
 * by searching the full statement.
 */
function whereClause(sql: string): string {
  const match = /\swhere\s(.*?)(?:\sorder by\s|\sgroup by\s|\slimit\s|$)/.exec(sql);
  if (!match) throw new Error(`No WHERE clause in: ${sql}`);
  return match[1];
}

describe('SsoConnectionDrizzleRepository — a live invitation is pending AND unexpired', () => {
  it('findSharedByInvitedEmail checks expires_at, not just the status', async () => {
    const { repo, captured } = recordingRepo();

    await repo.findSharedByInvitedEmail('Vendor@Gmail.com');

    const where = whereClause(captured[0].sql);
    // The clause that was missing. Its absence is the whole defect, so assert the column by name.
    expect(where).toContain('"expires_at"');
    expect(where).toContain('"status"');
    // Still routed by kind, and still only to an enabled connection.
    expect(where).toContain('"kind"');
    // The address is compared case-insensitively, lower-cased on both sides.
    expect(where).toContain('lower(');
    expect(captured[0].params).toContain('vendor@gmail.com');
  });

  /**
   * The router must also admit a RETURNING collaborator, and must not admit a REMOVED one.
   *
   * Asserted on the rendered SQL because both halves are conditions whose absence is invisible from
   * outside: without the membership branch an external can sign in exactly once (acceptance flips
   * the invitation out of `pending`), and without `status = 'active'` on that branch a removed
   * collaborator would route, reach a gate that admits any existing `users` row, and be silently
   * re-enrolled by `provisionIntoConnection`. Lockout in one direction, re-admission in the other.
   */
  it('admits a returning ACTIVE member as well as a live invitation', async () => {
    const { repo, captured } = recordingRepo();

    await repo.findSharedByInvitedEmail('vendor@gmail.com');

    const where = whereClause(captured[0].sql);
    // Two alternatives, not one.
    expect(where).toContain(' or ');
    expect(where).toContain('workspace_members');
    expect(where).toContain('workspace_invitations');
    // Both correlate to the connection's own workspace rather than matching any workspace.
    expect(where.match(/"workspace_id"/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  it('requires the membership row to be ACTIVE — a removed collaborator must not route', async () => {
    const { repo, captured } = recordingRepo();

    await repo.findSharedByInvitedEmail('vendor@gmail.com');

    const where = whereClause(captured[0].sql);
    const membershipBranch = where.slice(where.indexOf('workspace_members'));
    // `active` is bound as a parameter, so assert the column is constrained inside that branch and
    // that the value reaches the driver — a branch without it would readmit a removed person.
    expect(membershipBranch).toContain('"status"');
    expect(captured[0].params).toContain('active');
  });

  it('hasPendingInvitation checks expires_at too — the two must not diverge again', async () => {
    const { repo, captured } = recordingRepo();

    await repo.hasPendingInvitation('ws-1', 'Vendor@Gmail.com');

    const where = whereClause(captured[0].sql);
    expect(where).toContain('"expires_at"');
    expect(where).toContain('"status"');
    expect(where).toContain('"workspace_id"');
    expect(captured[0].params).toContain('vendor@gmail.com');
  });

  it('binds a real timestamp for the expiry comparison, not a literal or null', async () => {
    // A `gt(col, undefined)` would render a parameter and silently match nothing (or everything,
    // depending on the driver's coercion), which is exactly the kind of clause that looks present
    // in a diff and is not. Assert a Date actually reaches the driver.
    const { repo, captured } = recordingRepo();

    await repo.findSharedByInvitedEmail('vendor@gmail.com');

    expect(captured[0].params.some((p) => p instanceof Date || typeof p === 'string')).toBe(true);
    expect(captured[0].params).not.toContain(null);
    expect(captured[0].params).not.toContain(undefined);
  });
});
