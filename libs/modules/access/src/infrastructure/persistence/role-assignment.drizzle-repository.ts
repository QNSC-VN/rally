import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { InjectDrizzle } from '@platform';
import type { DrizzleDB } from '@platform';
import { userRoleAssignments, systemRoles } from '../../../../../../db/schema/access';
import type {
  UserRoleAssignment,
  AssignRoleInput,
  ScopeType,
  EffectiveAssignment,
} from '../../domain/access.types';
import { IRoleAssignmentRepository } from '../../domain/ports/role-assignment.repository';

@Injectable()
export class RoleAssignmentDrizzleRepository implements IRoleAssignmentRepository {
  constructor(@InjectDrizzle() private readonly db: DrizzleDB) {}

  async findById(id: string, workspaceId: string): Promise<UserRoleAssignment | null> {
    const rows = await this.db
      .select()
      .from(userRoleAssignments)
      .where(and(eq(userRoleAssignments.id, id), eq(userRoleAssignments.workspaceId, workspaceId)))
      .limit(1);
    return rows[0] ?? null;
  }

  async findExisting(
    userId: string,
    roleId: string,
    scopeType: ScopeType,
    scopeId: string | null,
    workspaceId: string,
  ): Promise<UserRoleAssignment | null> {
    const conditions = [
      eq(userRoleAssignments.userId, userId),
      eq(userRoleAssignments.roleId, roleId),
      eq(userRoleAssignments.scopeType, scopeType),
      eq(userRoleAssignments.workspaceId, workspaceId),
    ];

    if (scopeId !== null) {
      conditions.push(eq(userRoleAssignments.scopeId, scopeId));
    }

    const rows = await this.db
      .select()
      .from(userRoleAssignments)
      .where(and(...conditions))
      .limit(1);
    return rows[0] ?? null;
  }

  async listForUser(workspaceId: string, userId: string): Promise<UserRoleAssignment[]> {
    const rows = await this.db
      .select()
      .from(userRoleAssignments)
      .where(
        and(
          eq(userRoleAssignments.workspaceId, workspaceId),
          eq(userRoleAssignments.userId, userId),
        ),
      );
    return rows;
  }

  async listEffectiveForUser(workspaceId: string, userId: string): Promise<EffectiveAssignment[]> {
    const rows = await this.db
      .select({
        scopeType: userRoleAssignments.scopeType,
        scopeId: userRoleAssignments.scopeId,
        roleSlug: systemRoles.slug,
        permissions: systemRoles.permissions,
      })
      .from(userRoleAssignments)
      .innerJoin(systemRoles, eq(userRoleAssignments.roleId, systemRoles.id))
      .where(
        and(
          eq(userRoleAssignments.workspaceId, workspaceId),
          eq(userRoleAssignments.userId, userId),
        ),
      );
    return rows.map((r) => ({
      scopeType: r.scopeType,
      scopeId: r.scopeId,
      roleSlug: r.roleSlug,
      permissions: r.permissions as string[],
    }));
  }

  async create(input: AssignRoleInput): Promise<UserRoleAssignment> {
    const rows = await this.db
      .insert(userRoleAssignments)
      .values({
        id: input.id,
        workspaceId: input.workspaceId,
        userId: input.userId,
        roleId: input.roleId,
        scopeType: input.scopeType,
        scopeId: input.scopeId,
        grantedBy: input.grantedBy,
      })
      .returning();
    return rows[0];
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(userRoleAssignments).where(eq(userRoleAssignments.id, id));
  }
}
