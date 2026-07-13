import { Injectable } from '@nestjs/common';
import { and, eq, isNull, asc, sql, inArray } from 'drizzle-orm';
import { InjectDrizzle } from '@platform';
import type { DrizzleDB } from '@platform';
import { tasks, memberCapacity } from '../../../../../../db/schema/work';
import { users } from '../../../../../../db/schema/identity';
import type { RawTeamStatusTaskRow } from '../../domain/team-status.types';
import { ITeamStatusRepository } from '../../domain/ports/team-status.repository';

@Injectable()
export class TeamStatusDrizzleRepository implements ITeamStatusRepository {
  constructor(@InjectDrizzle() private readonly db: DrizzleDB) {}

  async getTaskRows(
    iterationId: string,
    workspaceId: string,
    teamId?: string | null,
  ): Promise<RawTeamStatusTaskRow[]> {
    // P3 refactor: Query from the dedicated `tasks` table instead of
    // `work_items WHERE type='task'`. Join with work_items for the
    // parent (work product) info.
    const conditions = [
      eq(tasks.workspaceId, workspaceId),
      isNull(tasks.deletedAt),
      // Task iteration matches directly OR its parent's iteration matches
      sql`(${tasks.iterationId} = ${iterationId} OR (SELECT p.iteration_id FROM work.work_items p WHERE p.id = ${tasks.parentId} AND p.deleted_at IS NULL) = ${iterationId})`,
    ];
    if (teamId) {
      conditions.push(eq(tasks.teamId, teamId));
    }

    // Fetch tasks with parent (work product) info via lateral subqueries.
    const taskRows = await this.db
      .select({
        id: tasks.id,
        itemKey: sql<string | null>`
          (SELECT p.item_key FROM work.work_items p
           WHERE p.id = ${tasks.parentId} AND p.deleted_at IS NULL)
        `.as('item_key'),
        title: tasks.title,
        type: sql<string>`'task'`.as('type'),
        scheduleState: tasks.state, // task_state enum
        parentId: tasks.parentId,
        parentKey: sql<string | null>`
          (SELECT p.item_key FROM work.work_items p
           WHERE p.id = ${tasks.parentId} AND p.deleted_at IS NULL)
        `.as('parent_key'),
        parentType: sql<string | null>`
          (SELECT p.type FROM work.work_items p
           WHERE p.id = ${tasks.parentId} AND p.deleted_at IS NULL)
        `.as('parent_type'),
        parentTitle: sql<string | null>`
          (SELECT p.title FROM work.work_items p
           WHERE p.id = ${tasks.parentId} AND p.deleted_at IS NULL)
        `.as('parent_title'),
        parentScheduleState: sql<string | null>`
          (SELECT p.schedule_state FROM work.work_items p
           WHERE p.id = ${tasks.parentId} AND p.deleted_at IS NULL)
        `.as('parent_schedule_state'),
        releaseId: sql<string | null>`
          (SELECT p.release_id FROM work.work_items p
           WHERE p.id = ${tasks.parentId} AND p.deleted_at IS NULL)
        `.as('release_id'),
        releaseName: sql<string | null>`
          (SELECT r.name FROM work.releases r
           INNER JOIN work.work_items p ON p.release_id = r.id
           WHERE p.id = ${tasks.parentId} AND p.deleted_at IS NULL)
        `.as('release_name'),
        assigneeId: tasks.assigneeId,
        estimateHours: tasks.estimateHours,
        todoHours: tasks.todoHours,
        actualHours: tasks.actualHours,
        rank: tasks.rank,
      })
      .from(tasks)
      .where(and(...conditions))
      .orderBy(asc(tasks.rank), asc(tasks.createdAt));

    // Batch-fetch user display info for all assignees.
    const assigneeIds = [...new Set(taskRows.map((r) => r.assigneeId).filter(Boolean))] as string[];
    let userMap = new Map<string, { displayName: string; avatarUrl: string | null }>();
    if (assigneeIds.length > 0) {
      const userRows = await this.db
        .select({ id: users.id, displayName: users.displayName, avatarUrl: users.avatarUrl })
        .from(users)
        .where(inArray(users.id, assigneeIds));
      userMap = new Map(
        userRows.map((u) => [u.id, { displayName: u.displayName, avatarUrl: u.avatarUrl }]),
      );
    }

    return taskRows.map((r) => {
      const userInfo = r.assigneeId ? userMap.get(r.assigneeId) : null;
      return {
        id: r.id,
        itemKey: r.itemKey ?? '',
        title: r.title,
        type: r.type,
        scheduleState: r.scheduleState,
        parentId: r.parentId,
        parentKey: r.parentKey,
        parentType: r.parentType,
        parentTitle: r.parentTitle,
        parentScheduleState: r.parentScheduleState,
        releaseId: r.releaseId,
        releaseName: r.releaseName,
        assigneeId: r.assigneeId,
        assigneeDisplayName: userInfo?.displayName ?? null,
        assigneeAvatarUrl: userInfo?.avatarUrl ?? null,
        estimateHours: r.estimateHours,
        todoHours: r.todoHours,
        actualHours: r.actualHours,
        rank: r.rank,
      };
    });
  }

  async getCapacities(iterationId: string, userIds: string[]): Promise<Map<string, number>> {
    if (userIds.length === 0) return new Map();

    const rows = await this.db
      .select({
        userId: memberCapacity.userId,
        capacityHours: memberCapacity.capacityHours,
      })
      .from(memberCapacity)
      .where(
        and(eq(memberCapacity.iterationId, iterationId), inArray(memberCapacity.userId, userIds)),
      );

    const map = new Map<string, number>();
    for (const row of rows) {
      map.set(row.userId, Number(row.capacityHours));
    }
    return map;
  }

  async upsertCapacity(input: {
    workspaceId: string;
    projectId: string;
    teamId: string;
    iterationId: string;
    userId: string;
    capacityHours: number;
  }): Promise<{ userId: string; capacityHours: number }> {
    const { userId, capacityHours, iterationId, projectId, teamId, workspaceId } = input;

    const existing = await this.db
      .select({ id: memberCapacity.id })
      .from(memberCapacity)
      .where(
        and(
          eq(memberCapacity.workspaceId, workspaceId),
          eq(memberCapacity.projectId, projectId),
          eq(memberCapacity.teamId, teamId),
          eq(memberCapacity.iterationId, iterationId),
          eq(memberCapacity.userId, userId),
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      await this.db
        .update(memberCapacity)
        .set({ capacityHours: String(capacityHours), updatedAt: new Date() })
        .where(
          and(eq(memberCapacity.id, existing[0].id), eq(memberCapacity.workspaceId, workspaceId)),
        );
    } else {
      await this.db.insert(memberCapacity).values({
        workspaceId: workspaceId,
        projectId,
        teamId,
        iterationId,
        userId,
        capacityHours: String(capacityHours),
      });
    }

    return { userId, capacityHours };
  }
}
