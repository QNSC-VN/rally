import { Injectable } from '@nestjs/common';
import { and, asc, eq, exists, gt, or, sql } from 'drizzle-orm';
import { InjectDrizzle } from '@platform';
import type { DrizzleDB } from '@platform';
import { ssoConnections, ssoConnectionDomains, users } from '../../../../../../db/schema/identity';
import { workspaceInvitations, workspaceMembers } from '../../../../../../db/schema/workspace';
import type { SsoConnection, ISsoConnectionRepository } from '@quynhonsemiconductor/identity';

/** Lower-cased email domain (the part after `@`), or null for a malformed email. */
function emailDomain(email: string): string | null {
  return email.split('@')[1]?.toLowerCase() ?? null;
}

/**
 * A LIVE pending invitation for `email` — `pending` AND not yet expired.
 *
 * Extracted because it was a rule with two homes and one of them was missing a clause:
 * `hasPendingInvitation` checked the expiry, `findSharedByInvitedEmail` did not. So an expired
 * invitation still ROUTED a login to its shared connection, which then refused it at the
 * invite-only gate — surfacing as `SSO_JIT_DISABLED` (and, from the BFF callback, as an opaque
 * `AUTH_TOKEN_INVALID`) where `NO_CONNECTION` is the honest answer. Two different refusals for
 * one cause, neither naming it.
 *
 * `status = 'pending'` alone is not the same question: a cron flips rows to `expired`
 * (`apps/worker/src/cron/cleanup.cron.ts`), so between a row's expiry and the next tick it is
 * still `pending` and must not admit anyone. The timestamp is authoritative; the status is a
 * projection of it that lags.
 */
function liveInvitationFor(email: string) {
  return and(
    eq(workspaceInvitations.status, 'pending'),
    sql`lower(${workspaceInvitations.email}) = ${email.toLowerCase()}`,
    gt(workspaceInvitations.expiresAt, new Date()),
  );
}

@Injectable()
export class SsoConnectionDrizzleRepository implements ISsoConnectionRepository {
  constructor(@InjectDrizzle() private readonly db: DrizzleDB) {}

  async findByExternalTenantId(
    provider: string,
    externalTenantId: string,
  ): Promise<SsoConnection | null> {
    const rows = await this.db
      .select()
      .from(ssoConnections)
      .where(
        and(
          eq(ssoConnections.provider, provider as 'entra'),
          eq(ssoConnections.externalTenantId, externalTenantId),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * Active `directory` connection that OWNS the email's domain (≤1 by the
   * `sso_connection_domains` UNIQUE(domain) constraint). Domains are stored
   * lower-cased.
   */
  async findDirectoryByEmailDomain(email: string): Promise<SsoConnection | null> {
    const domain = emailDomain(email);
    if (!domain) return null;
    const rows = await this.db
      .select({ conn: ssoConnections })
      .from(ssoConnections)
      .innerJoin(ssoConnectionDomains, eq(ssoConnectionDomains.connectionId, ssoConnections.id))
      .where(
        and(
          eq(ssoConnectionDomains.domain, domain),
          eq(ssoConnections.status, 'active'),
          eq(ssoConnections.kind, 'directory'),
        ),
      )
      .limit(1);
    return rows[0]?.conn ?? null;
  }

  /**
   * Active `shared` (consumer-IdP) connection this address may authenticate through — because it
   * holds a LIVE pending invitation, **or because it is already an active member**.
   *
   * THE SECOND HALF IS NOT AN EXTRA; without it an external could sign in exactly ONCE.
   * `acceptInvitation` flips the invitation to `accepted`, and `ConnectionRegistry.resolveForEmail`
   * is `findDirectoryByEmailDomain(email) ?? findSharedByInvitedEmail(email)` with no third tier —
   * so a pending-only predicate stopped matching the moment the invitee accepted. They became a
   * member and were then locked out of every subsequent login with `NO_CONNECTION`, recoverable only
   * by an admin issuing a fresh invitation before each sign-in. The Microsoft button is no escape:
   * it resolves the DIRECTORY row, whose `allowedEmailDomains` refuses a consumer address.
   *
   * The asymmetry that caused it is worth naming: the connection GATE already handled a returning
   * user (`assertConnectionAllows` admits `findByEmail(email) != null`), and the ROUTER did not. One
   * of the two knew that membership outlives an invitation.
   *
   * WHY MEMBERSHIP, AND NOT `invitation.status IN ('pending','accepted')`. An accepted invitation is
   * a historical fact that never expires or reverses, so routing on it would readmit someone whose
   * access has since been REMOVED — and that is not a cosmetic difference, because the gate's own
   * `findByEmail != null` branch would then admit them (their `users` row survives a removal), and
   * `ssoLoginFromConnection` treats an empty membership list as cause to call
   * `provisionIntoConnection`, silently re-enrolling them into the workspace. Both of those live in
   * the vendored package and cannot be fixed from here. Keying on an ACTIVE membership row means a
   * removed collaborator resolves to no connection at all and never reaches the gate, so the hole
   * stays unreachable by construction rather than by a second check someone must remember.
   *
   * Consumer IdPs are still never domain-routed: neither branch consults a domain, and a `shared`
   * connection owns no `sso_connection_domains` rows.
   */
  async findSharedByInvitedEmail(email: string): Promise<SsoConnection | null> {
    const normalized = email.toLowerCase();
    const rows = await this.db
      .select({ conn: ssoConnections })
      .from(ssoConnections)
      .where(
        and(
          eq(ssoConnections.status, 'active'),
          eq(ssoConnections.kind, 'shared'),
          or(
            // A fresh invitee, mid-onboarding: invited, unexpired, not yet accepted.
            exists(
              this.db
                .select({ one: sql`1` })
                .from(workspaceInvitations)
                .where(
                  and(
                    eq(workspaceInvitations.workspaceId, ssoConnections.workspaceId),
                    liveInvitationFor(normalized),
                  ),
                ),
            ),
            // A returning collaborator. `status = 'active'` is what makes a REMOVED one fall out.
            exists(
              this.db
                .select({ one: sql`1` })
                .from(workspaceMembers)
                .innerJoin(users, eq(users.id, workspaceMembers.userId))
                .where(
                  and(
                    eq(workspaceMembers.workspaceId, ssoConnections.workspaceId),
                    eq(workspaceMembers.status, 'active'),
                    sql`lower(${users.email}) = ${normalized}`,
                  ),
                ),
            ),
          ),
        ),
      )
      // Deterministic when a workspace has >1 shared connection: oldest wins.
      .orderBy(ssoConnections.createdAt, asc(ssoConnections.id))
      .limit(1);
    return rows[0]?.conn ?? null;
  }

  async findById(id: string): Promise<SsoConnection | null> {
    const rows = await this.db
      .select()
      .from(ssoConnections)
      .where(eq(ssoConnections.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  /** Active `shared` connections to render as explicit login buttons. */
  async listActiveShared(): Promise<SsoConnection[]> {
    return this.db
      .select()
      .from(ssoConnections)
      .where(and(eq(ssoConnections.status, 'active'), eq(ssoConnections.kind, 'shared')));
  }

  /** True if the email's domain is owned by this (directory) connection — the provisioning gate. */
  async connectionOwnsEmailDomain(connectionId: string, email: string): Promise<boolean> {
    const domain = emailDomain(email);
    if (!domain) return false;
    const rows = await this.db
      .select({ id: ssoConnectionDomains.id })
      .from(ssoConnectionDomains)
      .where(
        and(
          eq(ssoConnectionDomains.connectionId, connectionId),
          eq(ssoConnectionDomains.domain, domain),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  /**
   * True if `email` holds a live PENDING invitation to `workspaceId` — lets an
   * invited-but-not-yet-provisioned user through the invite-only gate
   * (`jitEnabled=false`) on their first SSO login.
   */
  async hasPendingInvitation(workspaceId: string, email: string): Promise<boolean> {
    const rows = await this.db
      .select({ id: workspaceInvitations.id })
      .from(workspaceInvitations)
      .where(and(eq(workspaceInvitations.workspaceId, workspaceId), liveInvitationFor(email)))
      .limit(1);
    return rows.length > 0;
  }
}
