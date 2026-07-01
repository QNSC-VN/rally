import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { InjectDrizzle } from '@platform';
import type { DrizzleDB, DbExecutor } from '@platform';
import { projectMembers } from '../../../../../../db/schema/work';
import type {
  ProjectMember,
  AddProjectMemberInput,
  UpdateProjectMemberInput,
} from '../../domain/project.types';
import { IProjectMemberRepository } from '../../domain/ports/project-member.repository';

@Injectable()
export class ProjectMemberDrizzleRepository implements IProjectMemberRepository {
  constructor(@InjectDrizzle() private readonly db: DrizzleDB) {}

  async findMember(projectId: string, userId: string): Promise<ProjectMember | null> {
    const rows = await this.db
      .select()
      .from(projectMembers)
      .where(
        and(
          eq(projectMembers.projectId, projectId),
          eq(projectMembers.userId, userId),
          eq(projectMembers.status, 'active'),
        ),
      )
      .limit(1);
    return (rows[0] as ProjectMember | undefined) ?? null;
  }

  async findMemberById(id: string): Promise<ProjectMember | null> {
    const rows = await this.db
      .select()
      .from(projectMembers)
      .where(eq(projectMembers.id, id))
      .limit(1);
    return (rows[0] as ProjectMember | undefined) ?? null;
  }

  async listByProject(projectId: string): Promise<ProjectMember[]> {
    const rows = await this.db
      .select()
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.status, 'active')))
      .orderBy(projectMembers.joinedAt);
    return rows as ProjectMember[];
  }

  async addMember(input: AddProjectMemberInput, tx?: DbExecutor): Promise<ProjectMember> {
    const rows = await (tx ?? this.db)
      .insert(projectMembers)
      .values({
        id: input.id,
        tenantId: input.tenantId,
        projectId: input.projectId,
        userId: input.userId,
        roleId: input.roleId ?? null,
        status: 'active',
        joinedAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();
    return rows[0] as ProjectMember;
  }

  async updateMember(id: string, input: UpdateProjectMemberInput): Promise<ProjectMember> {
    const rows = await this.db
      .update(projectMembers)
      .set({
        ...(input.roleId !== undefined && { roleId: input.roleId }),
        ...(input.status !== undefined && { status: input.status }),
        updatedAt: new Date(),
      })
      .where(eq(projectMembers.id, id))
      .returning();
    return rows[0] as ProjectMember;
  }

  async removeMember(projectId: string, userId: string): Promise<void> {
    await this.db
      .update(projectMembers)
      .set({ status: 'removed', updatedAt: new Date() })
      .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)));
  }
}
