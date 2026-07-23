import { Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { InjectDrizzle } from '@platform';
import type { DrizzleDB } from '@platform';
import { ssoConnections, ssoConnectionDomains } from '../../../../../../db/schema/identity';
import { workspaceInvitations } from '../../../../../../db/schema/workspace';
import type { SsoConnection, ISsoConnectionRepository } from '@qnsc-vn/identity';

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
    const domain = email.split('@')[1]?.toLowerCase();
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
   * Active `shared` (consumer-IdP) connection the email has a PENDING invitation
   * to. Consumer IdPs are never domain-routed — access is gated by invite.
   */
  async findSharedByInvitedEmail(email: string): Promise<SsoConnection | null> {
    const rows = await this.db
      .select({ conn: ssoConnections })
      .from(ssoConnections)
      .innerJoin(
        workspaceInvitations,
        eq(workspaceInvitations.workspaceId, ssoConnections.workspaceId),
      )
      .where(
        and(
          eq(ssoConnections.status, 'active'),
          eq(ssoConnections.kind, 'shared'),
          eq(workspaceInvitations.status, 'pending'),
          sql`lower(${workspaceInvitations.email}) = ${email.toLowerCase()}`,
        ),
      )
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
    const domain = email.split('@')[1]?.toLowerCase();
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
}
