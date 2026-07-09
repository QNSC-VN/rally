import { Injectable } from '@nestjs/common';
import { and, eq, isNull, asc, sql, inArray } from 'drizzle-orm';
import { InjectDrizzle } from '@platform';
import type { DrizzleDB } from '@platform';
import { workItems, memberCapacity } from '../../../../../../db/schema/work';
import { users } from '../../../../../../db/schema/identity';
import type { RawTeamStatusTaskRow } from '../../domain/team-status.types';
import { ITeamStatusRepository } from '../../domain/ports/team-status.repository';

@Injectable()
export class TeamStatusDrizzleRepository implements ITeamStatusRepository {
  constructor(@InjectDrizzle() private readonly db: DrizzleDB) {}

  async getTaskRows(
    iterationId: string,
    tenantId: string,
    teamId?: string,
  ): Promise<RawTeamStatusTaskRow[]> {
    const conditions = [
      eq(workItems.iterationId, iterationId),
      eq(workItems.tenantId, tenantId),
      eq(workItems.type, 'task'),
      isNull(workItems.deletedAt),
    ];
    if (teamId) {
      conditions.push(eq(workItems.teamId, teamId));
    }

    // Fetch tasks with parent and release info via lateral subqueries.
    const taskRows = await this.db
      .select({
        id: workItems.id,
        itemKey: workItems.itemKey,
        title: workItems.title,
        type: workItems.type,
        scheduleState: workItems.scheduleState,
        parentId: workItems.parentId,
        parentKey: sql<string | null>`
          (SELECT p.item_key FROM work.work_items p
           WHERE p.id = ${workItems.parentId} AND p.deleted_at IS NULL)
        `.as('parent_key'),
        parentType: sql<string | null>`
          (SELECT p.type FROM work.work_items p
           WHERE p.id = ${workItems.parentId} AND p.deleted_at IS NULL)
        `.as('parent_type'),
        parentTitle: sql<string | null>`
          (SELECT p.title FROM work.work_items p
           WHERE p.id = ${workItems.parentId} AND p.deleted_at IS NULL)
        `.as('parent_title'),
        parentScheduleState: sql<string | null>`
          (SELECT p.schedule_state FROM work.work_items p
           WHERE p.id = ${workItems.parentId} AND p.deleted_at IS NULL)
        `.as('parent_schedule_state'),
        releaseId: workItems.releaseId,
        releaseName: sql<string | null>`
          (SELECT r.name FROM work.releases r WHERE r.id = ${workItems.releaseId})
        `.as('release_name'),
        assigneeId: workItems.assigneeId,
        estimateHours: workItems.estimateHours,
        todoHours: workItems.todoHours,
        actualHours: workItems.actualHours,
        rank: workItems.rank,
      })
      .from(workItems)
      .where(and(...conditions))
      .orderBy(asc(workItems.rank), asc(workItems.itemKey));

    // Batch-fetch user display info for all assignees.
    const assigneeIds = [...new Set(taskRows.map((r) => r.assigneeId).filter(Boolean))] as string[];
    let userMap = new Map<string, { displayName: string; avatarUrl: string | null }>();
    if (assigneeIds.length > 0) {
      const userRows = await this.db
        .select({ id: users.id, displayName: users.displayName, avatarUrl: users.avatarUrl })
        .from(users)
        .where(inArray(users.id, assigneeIds));
      userMap = new Map(userRows.map((u) => [u.id, { displayName: u.displayName, avatarUrl: u.avatarUrl }]));
    }

    return taskRows.map((r) => {
      const userInfo = r.assigneeId ? userMap.get(r.assigneeId) : null;
      return {
        id: r.id,
        itemKey: r.itemKey,
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

  async getCapacities(
    iterationId: string,
    userIds: string[],
  ): Promise<Map<string, number>> {
    if (userIds.length === 0) return new Map();

    const rows = await this.db
      .select({
        userId: memberCapacity.userId,
        capacityHours: memberCapacity.capacityHours,
      })
      .from(memberCapacity)
      .where(
        and(
          eq(memberCapacity.iterationId, iterationId),
          inArray(memberCapacity.userId, userIds),
        ),
      );

    const map = new Map<string, number>();
    for (const row of rows) {
      map.set(row.userId, Number(row.capacityHours));
    }
    return map;
  }

  async upsertCapacity(input: {
    tenantId: string;
    projectId: string;
    teamId: string;
    iterationId: string;
    userId: string;
    capacityHours: number;
  }): Promise<{ userId: string; capacityHours: number }> {
    const { userId, capacityHours, iterationId, projectId, teamId, tenantId } = input;

    const existing = await this.db
      .select({ id: memberCapacity.id })
      .from(memberCapacity)
      .where(
        and(
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
        .where(eq(memberCapacity.id, existing[0].id));
    } else {
      await this.db.insert(memberCapacity).values({
        tenantId,
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