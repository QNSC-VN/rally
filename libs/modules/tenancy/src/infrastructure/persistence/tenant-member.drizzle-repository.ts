import { Injectable } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { InjectDrizzle } from '@platform';
import type { DrizzleDB, DbExecutor } from '@platform';
import { tenantMembers, tenants } from '../../../../../../db/schema/tenancy';
import { userRoleAssignments, systemRoles } from '../../../../../../db/schema/access';
import type {
  TenantMember,
  TenantMembership,
  CreateTenantMemberInput,
} from '../../domain/tenancy.types';
import type { ITenantMemberRepository } from '../../domain/ports/tenant-member.repository';

@Injectable()
export class TenantMemberDrizzleRepository implements ITenantMemberRepository {
  constructor(@InjectDrizzle() private readonly db: DrizzleDB) {}

  async findByUserId(userId: string): Promise<TenantMembership[]> {
    const rows = await this.db
      .select({
        tenantId: tenantMembers.tenantId,
        tenantName: tenants.name,
        tenantSlug: tenants.slug,
        lastActiveAt: tenantMembers.lastActiveAt,
        roleSlug: systemRoles.slug,
        roleName: systemRoles.name,
      })
      .from(tenantMembers)
      .innerJoin(tenants, eq(tenants.id, tenantMembers.tenantId))
      .leftJoin(
        userRoleAssignments,
        and(
          eq(userRoleAssignments.userId, tenantMembers.userId),
          eq(userRoleAssignments.tenantId, tenantMembers.tenantId),
          eq(userRoleAssignments.scopeType, 'workspace'),
        ),
      )
      .leftJoin(systemRoles, eq(systemRoles.id, userRoleAssignments.roleId))
      .where(and(eq(tenantMembers.userId, userId), eq(tenantMembers.status, 'active')))
      .orderBy(desc(tenantMembers.lastActiveAt));

    return rows.map((r) => ({
      tenantId: r.tenantId,
      tenantName: r.tenantName,
      tenantSlug: r.tenantSlug,
      lastActiveAt: r.lastActiveAt ? r.lastActiveAt.toISOString() : null,
      roleSlug: r.roleSlug ?? null,
      roleName: r.roleName ?? null,
    }));
  }

  async findByUserAndTenant(userId: string, tenantId: string): Promise<TenantMember | null> {
    const rows = await this.db
      .select()
      .from(tenantMembers)
      .where(and(eq(tenantMembers.userId, userId), eq(tenantMembers.tenantId, tenantId)))
      .limit(1);

    return (rows[0] as TenantMember | undefined) ?? null;
  }

  async create(input: CreateTenantMemberInput, tx?: DbExecutor): Promise<void> {
    const executor = tx ?? this.db;
    await executor
      .insert(tenantMembers)
      .values({
        id: input.id,
        tenantId: input.tenantId,
        userId: input.userId,
        roleId: input.roleId ?? null,
      })
      .onConflictDoNothing();
  }

  async touchLastActive(userId: string, tenantId: string): Promise<void> {
    await this.db
      .update(tenantMembers)
      .set({ lastActiveAt: new Date(), updatedAt: new Date() })
      .where(and(eq(tenantMembers.userId, userId), eq(tenantMembers.tenantId, tenantId)));
  }
}
