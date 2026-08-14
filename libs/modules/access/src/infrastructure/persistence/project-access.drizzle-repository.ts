import { Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { InjectDrizzle } from '@platform';
import type { DrizzleDB, DbExecutor } from '@platform';
import type { ProjectAccessLevel } from '@shared-kernel';
import { projectMembers, projects } from '../../../../../../db/schema/work';
import { workspaceMembers } from '../../../../../../db/schema/workspace';
import type { ProjectAccessGrant } from '../../domain/project-access';
import { IProjectAccessRepository } from '../../domain/ports/project-access.repository';
import { selectWorkspaceAdminUserIds } from './workspace-admin-ids';

@Injectable()
export class ProjectAccessDrizzleRepository implements IProjectAccessRepository {
  constructor(@InjectDrizzle() private readonly db: DrizzleDB) {}

  async findLiveProject(
    workspaceId: string,
    projectId: string,
    exec?: DbExecutor,
  ): Promise<{ id: string } | null> {
    const rows = await (exec ?? this.db)
      .select({ id: projects.id })
      .from(projects)
      .where(
        and(
          eq(projects.id, projectId),
          eq(projects.workspaceId, workspaceId),
          isNull(projects.deletedAt),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async isActiveWorkspaceMember(
    workspaceId: string,
    userId: string,
    exec?: DbExecutor,
  ): Promise<boolean> {
    const rows = await (exec ?? this.db)
      .select({ id: workspaceMembers.id })
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, workspaceId),
          eq(workspaceMembers.userId, userId),
          eq(workspaceMembers.status, 'active'),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  async listWorkspaceAdminUserIds(workspaceId: string, exec?: DbExecutor): Promise<string[]> {
    return selectWorkspaceAdminUserIds(exec ?? this.db, workspaceId);
  }

  async findGrant(
    projectId: string,
    userId: string,
    exec?: DbExecutor,
  ): Promise<ProjectAccessGrant | null> {
    const rows = await (exec ?? this.db)
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
    return rows[0] ?? null;
  }

  async createGrant(
    input: {
      id: string;
      workspaceId: string;
      projectId: string;
      userId: string;
      accessLevel?: ProjectAccessLevel;
    },
    exec?: DbExecutor,
  ): Promise<ProjectAccessGrant> {
    // `uq_project_member` is on (project_id, user_id) with NO status qualifier, so re-adding a
    // user previously removed from this project collides with their own `removed` row on a plain
    // INSERT (a raw unique violation, surfacing as an unhandled 500 — `findGrant` only looks at
    // active rows, so it never sees this coming). Reactivate the row instead.
    //
    // The supplied `accessLevel` travels through BOTH the insert and the reactivation: no caller
    // "follows with a PATCH" (every add flow passes the level up front), so resetting to NULL
    // here made every remove-then-add land as No Access regardless of what was picked. With no
    // level supplied, NULL remains the honest value — a stale level is never resurrected.
    const level = input.accessLevel !== undefined ? input.accessLevel : null;
    const rows = await (exec ?? this.db)
      .insert(projectMembers)
      .values({
        id: input.id,
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        userId: input.userId,
        accessLevel: level,
        status: 'active',
        joinedAt: new Date(),
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [projectMembers.projectId, projectMembers.userId],
        set: {
          status: 'active',
          accessLevel: level,
          joinedAt: new Date(),
          updatedAt: new Date(),
        },
      })
      .returning();
    return rows[0];
  }

  async setGrantLevel(
    id: string,
    accessLevel: ProjectAccessLevel,
    exec?: DbExecutor,
  ): Promise<ProjectAccessGrant> {
    // Level only, deliberately: `joined_at` belongs to the membership, not to the level, and
    // re-stamping it on every Admin ⇄ Editor change would rewrite the roster's own ordering.
    const rows = await (exec ?? this.db)
      .update(projectMembers)
      .set({ accessLevel, updatedAt: new Date() })
      .where(eq(projectMembers.id, id))
      .returning();
    return rows[0];
  }
}
