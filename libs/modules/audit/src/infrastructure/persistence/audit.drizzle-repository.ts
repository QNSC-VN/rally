import { Injectable } from '@nestjs/common';
import { and, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { InjectDrizzle } from '@platform';
import type { DrizzleDB, PagedResult } from '@platform';
import { auditLogs } from '../../../../../../db/schema/audit';
import { users } from '../../../../../../db/schema/identity';
import type { AuditLog, CreateAuditLogInput } from '../../domain/audit.types';
import type { IAuditRepository, AuditFilters } from '../../domain/ports/audit.repository';

@Injectable()
export class AuditDrizzleRepository implements IAuditRepository {
  constructor(@InjectDrizzle() private readonly db: DrizzleDB) {}

  async create(input: CreateAuditLogInput): Promise<void> {
    await this.db
      .insert(auditLogs)
      .values({
        id: input.id,
        workspaceId: input.workspaceId,
        actorId: input.actorId,
        actorEmail: input.actorEmail,
        action: input.action,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        projectId: input.projectId,
        changes: input.changes,
        metadata: input.metadata ?? {},
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
        sourceEventId: input.sourceEventId,
      })
      // When sourceEventId is non-null and already exists, silently skip the insert.
      // When null (direct service calls), no conflict occurs (NULL != NULL in PG).
      .onConflictDoNothing({ target: auditLogs.sourceEventId });
  }

  async listForWorkspace(
    workspaceId: string,
    filters: AuditFilters,
    args: { limit: number; offset: number },
  ): Promise<PagedResult<AuditLog>> {
    const conditions = [eq(auditLogs.workspaceId, workspaceId)];
    if (filters.actorId) conditions.push(eq(auditLogs.actorId, filters.actorId));
    if (filters.resourceType) conditions.push(eq(auditLogs.resourceType, filters.resourceType));
    if (filters.resourceId) conditions.push(eq(auditLogs.resourceId, filters.resourceId));
    if (filters.projectId) conditions.push(eq(auditLogs.projectId, filters.projectId));
    if (filters.action) conditions.push(eq(auditLogs.action, filters.action));
    if (filters.from) conditions.push(gte(auditLogs.occurredAt, filters.from));
    if (filters.to) conditions.push(lte(auditLogs.occurredAt, filters.to));

    // Resolve the actor's display name/email from the users table at read time
    // (LEFT JOIN — a removed user leaves the row intact with null name), mirroring
    // the work-item activity log. A stored actorEmail on the row still wins so a
    // future write-time capture remains authoritative.
    const limit = args.limit + 1;
    const rows = await this.db
      .select({
        id: auditLogs.id,
        workspaceId: auditLogs.workspaceId,
        actorId: auditLogs.actorId,
        actorName: users.displayName,
        actorEmail: sql<string | null>`coalesce(${auditLogs.actorEmail}, ${users.email})`,
        action: auditLogs.action,
        resourceType: auditLogs.resourceType,
        resourceId: auditLogs.resourceId,
        projectId: auditLogs.projectId,
        changes: auditLogs.changes,
        metadata: auditLogs.metadata,
        ipAddress: auditLogs.ipAddress,
        userAgent: auditLogs.userAgent,
        occurredAt: auditLogs.occurredAt,
        sourceEventId: auditLogs.sourceEventId,
      })
      .from(auditLogs)
      .leftJoin(users, eq(auditLogs.actorId, users.id))
      .where(and(...conditions))
      .orderBy(desc(auditLogs.occurredAt))
      .limit(limit)
      .offset(args.offset);

    const hasNextPage = rows.length > args.limit;
    const data = (hasNextPage ? rows.slice(0, args.limit) : rows) as AuditLog[];

    return {
      data,
      pageInfo: {
        hasNextPage,
        nextCursor: null, // audit uses offset pagination for simplicity
        limit: args.limit,
      },
    };
  }
}
