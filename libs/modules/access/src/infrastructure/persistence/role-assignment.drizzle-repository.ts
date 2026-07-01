import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { InjectDrizzle } from '@platform';
import type { DrizzleDB } from '@platform';
import { userRoleAssignments } from '../../../../../../db/schema/access';
import type { UserRoleAssignment, AssignRoleInput, ScopeType } from '../../domain/access.types';
import { IRoleAssignmentRepository } from '../../domain/ports/role-assignment.repository';

@Injectable()
export class RoleAssignmentDrizzleRepository implements IRoleAssignmentRepository {
  constructor(@InjectDrizzle() private readonly db: DrizzleDB) {}

  async findById(id: string): Promise<UserRoleAssignment | null> {
    const rows = await this.db
      .select()
      .from(userRoleAssignments)
      .where(eq(userRoleAssignments.id, id))
      .limit(1);
    return (rows[0] as UserRoleAssignment | undefined) ?? null;
  }

  async findExisting(
    userId: string,
    roleId: string,
    scopeType: ScopeType,
    scopeId: string | null,
  ): Promise<UserRoleAssignment | null> {
    const conditions = [
      eq(userRoleAssignments.userId, userId),
      eq(userRoleAssignments.roleId, roleId),
      eq(userRoleAssignments.scopeType, scopeType),
    ];

    if (scopeId !== null) {
      conditions.push(eq(userRoleAssignments.scopeId, scopeId));
    }

    const rows = await this.db
      .select()
      .from(userRoleAssignments)
      .where(and(...conditions))
      .limit(1);
    return (rows[0] as UserRoleAssignment | undefined) ?? null;
  }

  async listForUser(tenantId: string, userId: string): Promise<UserRoleAssignment[]> {
    const rows = await this.db
      .select()
      .from(userRoleAssignments)
      .where(
        and(eq(userRoleAssignments.tenantId, tenantId), eq(userRoleAssignments.userId, userId)),
      );
    return rows as UserRoleAssignment[];
  }

  async create(input: AssignRoleInput): Promise<UserRoleAssignment> {
    const rows = await this.db
      .insert(userRoleAssignments)
      .values({
        id: input.id,
        tenantId: input.tenantId,
        userId: input.userId,
        roleId: input.roleId,
        scopeType: input.scopeType,
        scopeId: input.scopeId,
        grantedBy: input.grantedBy,
      })
      .returning();
    return rows[0] as UserRoleAssignment;
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(userRoleAssignments).where(eq(userRoleAssignments.id, id));
  }
}
