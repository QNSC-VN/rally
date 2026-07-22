import { Injectable } from '@nestjs/common';
import { and, eq, isNull, asc, sql, inArray } from 'drizzle-orm';
import { InjectDrizzle } from '@platform';
import type { DrizzleDB } from '@platform';
import {
  tasks,
  workItems,
  releases,
  memberCapacity,
  teamMembers,
  projectMembers,
} from '../../../../../../db/schema/work';
import { alias } from 'drizzle-orm/pg-core';
import { users } from '../../../../../../db/schema/identity';
import type { RawTeamStatusTaskRow, TeamStatusRosterMember } from '../../domain/team-status.types';
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
    // Parent work item + its release, joined once (see the select below for why
    // this replaced correlated subqueries).
    const parent = alias(workItems, 'parent');
    const release = alias(releases, 'parent_release');

    const conditions = [
      eq(tasks.workspaceId, workspaceId),
      isNull(tasks.deletedAt),
      // Task iteration matches directly OR its parent's iteration matches.
      sql`(${tasks.iterationId} = ${iterationId} OR ${parent.iterationId} = ${iterationId})`,
    ];
    if (teamId) {
      conditions.push(eq(tasks.teamId, teamId));
    }

    // Fetch tasks with parent (work product) info via lateral subqueries.
    const taskRows = await this.db
      .select({
        id: tasks.id,
        itemKey: tasks.itemKey,
        title: tasks.title,
        type: sql<string>`'task'`.as('type'),
        scheduleState: tasks.state, // task_state enum
        parentId: tasks.parentId,
        // Parent work product + its release, resolved by a LEFT JOIN rather than
        // per-row correlated subqueries. The subquery form returned NULL for
        // every parent field (key/title/type/state) at runtime even though the
        // same SQL resolves by hand — the "Work Product" column rendered blank.
        // A join is both correct and one pass instead of six subqueries per row.
        parentKey: parent.itemKey,
        parentType: parent.type,
        parentTitle: parent.title,
        parentScheduleState: parent.scheduleState,
        releaseId: parent.releaseId,
        releaseName: release.name,
        assigneeId: tasks.assigneeId,
        estimateHours: tasks.estimateHours,
        todoHours: tasks.todoHours,
        actualHours: tasks.actualHours,
        rank: tasks.rank,
      })
      .from(tasks)
      .leftJoin(parent, and(eq(parent.id, tasks.parentId), isNull(parent.deletedAt)))
      .leftJoin(release, eq(release.id, parent.releaseId))
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

  async getRosterMembers(input: {
    workspaceId: string;
    projectId: string;
    teamId?: string | null;
  }): Promise<TeamStatusRosterMember[]> {
    const { workspaceId, projectId, teamId } = input;
    const columns = {
      id: users.id,
      displayName: users.displayName,
      avatarUrl: users.avatarUrl,
    };

    if (teamId) {
      return this.db
        .select(columns)
        .from(teamMembers)
        .innerJoin(users, eq(teamMembers.userId, users.id))
        .where(
          and(
            eq(teamMembers.workspaceId, workspaceId),
            eq(teamMembers.teamId, teamId),
            eq(teamMembers.status, 'active'),
          ),
        )
        .orderBy(asc(users.displayName));
    }

    return this.db
      .select(columns)
      .from(projectMembers)
      .innerJoin(users, eq(projectMembers.userId, users.id))
      .where(
        and(
          eq(projectMembers.workspaceId, workspaceId),
          eq(projectMembers.projectId, projectId),
          eq(projectMembers.status, 'active'),
        ),
      )
      .orderBy(asc(users.displayName));
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
