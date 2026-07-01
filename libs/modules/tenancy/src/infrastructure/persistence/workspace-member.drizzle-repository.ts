import { Injectable } from '@nestjs/common';
import { and, count, eq, lt } from 'drizzle-orm';
import { InjectDrizzle, buildPageResult } from '@platform';
import type { DrizzleDB, DbExecutor, CursorPayload, PagedResult } from '@platform';
import { workspaceMembers } from '../../../../../../db/schema/tenancy';
import { users } from '../../../../../../db/schema/identity';
import { systemRoles, userRoleAssignments } from '../../../../../../db/schema/access';
import type {
  WorkspaceMember,
  WorkspaceMemberWithProfile,
  AddMemberInput,
  UpdateMemberInput,
} from '../../domain/tenancy.types';
import { IWorkspaceMemberRepository } from '../../domain/ports/workspace-member.repository';

@Injectable()
export class WorkspaceMemberDrizzleRepository implements IWorkspaceMemberRepository {
  constructor(@InjectDrizzle() private readonly db: DrizzleDB) {}

  async findMember(workspaceId: string, userId: string): Promise<WorkspaceMember | null> {
    const rows = await this.db
      .select()
      .from(workspaceMembers)
      .where(
        and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)),
      )
      .limit(1);
    return (rows[0] as WorkspaceMember | undefined) ?? null;
  }

  async findMemberById(id: string): Promise<WorkspaceMember | null> {
    const rows = await this.db
      .select()
      .from(workspaceMembers)
      .where(eq(workspaceMembers.id, id))
      .limit(1);
    return (rows[0] as WorkspaceMember | undefined) ?? null;
  }

  async listMembers(
    workspaceId: string,
    { limit, cursor }: { limit: number; cursor: CursorPayload | null },
  ): Promise<PagedResult<WorkspaceMember>> {
    const conditions = [eq(workspaceMembers.workspaceId, workspaceId)];

    if (cursor) {
      conditions.push(lt(workspaceMembers.joinedAt, new Date(cursor.k[0] as string)));
    }

    const rows = await this.db
      .select()
      .from(workspaceMembers)
      .where(and(...conditions))
      .orderBy(workspaceMembers.joinedAt)
      .limit(limit + 1);

    return buildPageResult(rows as WorkspaceMember[], limit, (m) => [m.joinedAt.toISOString()]);
  }

  /** Returns workspace members joined with user profile and current workspace-scope role. */
  async listMembersWithProfile(workspaceId: string): Promise<WorkspaceMemberWithProfile[]> {
    const rows = await this.db
      .select({
        id: workspaceMembers.id,
        workspaceId: workspaceMembers.workspaceId,
        userId: workspaceMembers.userId,
        status: workspaceMembers.status,
        joinedAt: workspaceMembers.joinedAt,
        createdAt: workspaceMembers.createdAt,
        displayName: users.displayName,
        email: users.email,
        avatarUrl: users.avatarUrl,
        roleAssignmentId: userRoleAssignments.id,
        roleId: userRoleAssignments.roleId,
        roleSlug: systemRoles.slug,
        roleName: systemRoles.name,
      })
      .from(workspaceMembers)
      .leftJoin(users, eq(users.id, workspaceMembers.userId))
      .leftJoin(
        userRoleAssignments,
        and(
          eq(userRoleAssignments.userId, workspaceMembers.userId),
          eq(userRoleAssignments.scopeType, 'workspace'),
        ),
      )
      .leftJoin(systemRoles, eq(systemRoles.id, userRoleAssignments.roleId))
      .where(eq(workspaceMembers.workspaceId, workspaceId))
      .orderBy(workspaceMembers.joinedAt);

    return rows.map((r) => ({
      id: r.id,
      workspaceId: r.workspaceId,
      userId: r.userId,
      status: r.status,
      joinedAt: r.joinedAt ?? new Date(),
      createdAt: r.createdAt,
      displayName: r.displayName ?? r.email ?? r.userId,
      email: r.email ?? '',
      avatarUrl: r.avatarUrl ?? null,
      roleAssignmentId: r.roleAssignmentId ?? null,
      roleId: r.roleId ?? null,
      roleSlug: r.roleSlug ?? null,
      roleName: r.roleName ?? null,
    }));
  }

  async addMember(input: AddMemberInput, tx?: DbExecutor): Promise<WorkspaceMember> {
    const rows = await (tx ?? this.db)
      .insert(workspaceMembers)
      .values({
        id: input.id,
        tenantId: input.tenantId,
        workspaceId: input.workspaceId,
        userId: input.userId,
        roleId: input.roleId ?? null,
        status: 'active',
        joinedAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();
    return rows[0] as WorkspaceMember;
  }

  async updateMember(id: string, input: UpdateMemberInput): Promise<WorkspaceMember> {
    const rows = await this.db
      .update(workspaceMembers)
      .set({
        ...(input.roleId !== undefined && { roleId: input.roleId }),
        ...(input.status !== undefined && { status: input.status }),
        updatedAt: new Date(),
      })
      .where(eq(workspaceMembers.id, id))
      .returning();
    return rows[0] as WorkspaceMember;
  }

  async removeMember(workspaceId: string, userId: string): Promise<void> {
    await this.db
      .update(workspaceMembers)
      .set({ status: 'removed', updatedAt: new Date() })
      .where(
        and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)),
      );
  }

  async isMember(workspaceId: string, userId: string): Promise<boolean> {
    const result = await this.findMember(workspaceId, userId);
    return result !== null && result.status === 'active';
  }

  async countActiveAdmins(workspaceId: string): Promise<number> {
    // roleId === 'admin' is a simplification; real implementation may join roles table
    const rows = await this.db
      .select({ cnt: count() })
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, workspaceId),
          eq(workspaceMembers.roleId, 'admin'),
          eq(workspaceMembers.status, 'active'),
        ),
      );
    return Number(rows[0]?.cnt ?? 0);
  }
}
