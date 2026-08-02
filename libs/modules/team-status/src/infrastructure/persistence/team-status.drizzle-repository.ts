import { Injectable } from '@nestjs/common';
import { and, eq, isNull, asc, sql, inArray } from 'drizzle-orm';
import { InjectDrizzle } from '@platform';
import type { DrizzleDB } from '@platform';
import {
  tasks,
  workItems,
  releases,
  iterations,
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
    const iteration = alias(iterations, 'task_iteration');

    /**
     * Whose work this is, in THREE tiers — the same expression the Phase 6 Team Capacity projection
     * uses (`reporting.drizzle-repository.ts`).
     *
     * This was a strict `tasks.team_id = ?`. A task's team only DEFAULTS to its parent's (SRS P1-04),
     * so a Story with no team of its own produces tasks with `team_id IS NULL` — and SQL equality
     * never matches NULL. With a Team selected, Team Status dropped exactly those tasks while Team
     * Capacity kept them through the iteration's team, so the two screens reported different
     * Estimate/ToDo/Actual totals for the same Project + Team + Iteration. The Team Capacity SRS is
     * explicit that the scoped Task set comes from "the Task's PARENT Story/Defect Project, Team and
     * Iteration assignment", and that Capacity "must use the same source/table/API domain as
     * Track > Team Status".
     *
     * The comment in the reporting repository already claimed parity with this method. That was true
     * of the iteration-membership half below and false of the team half.
     */
    const resolvedTeam = sql`coalesce(${tasks.teamId}, ${parent.teamId}, ${iteration.teamId})`;

    const conditions = [
      eq(tasks.workspaceId, workspaceId),
      isNull(tasks.deletedAt),
      // Task iteration matches directly OR its parent's iteration matches.
      sql`(${tasks.iterationId} = ${iterationId} OR ${parent.iterationId} = ${iterationId})`,
    ];
    if (teamId) {
      conditions.push(sql`${resolvedTeam} = ${teamId}::uuid`);
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
      /**
       * INNER, not LEFT.
       *
       * A soft delete stamps `deleted_at` on the one row and never cascades to `work.tasks` (the FK is
       * `ON DELETE cascade`, which a soft delete does not fire). Under a LEFT join those orphaned tasks
       * still matched on `tasks.iteration_id` and were counted here, with a blank Work Product column —
       * while Iteration Status and the Phase 6 projection both inner-join the parent and exclude them.
       * So deleting a Story silently moved the two screens' Estimate/ToDo/Actual totals apart, and the
       * surviving rows were unreachable from any Work Item detail.
       */
      .innerJoin(parent, and(eq(parent.id, tasks.parentId), isNull(parent.deletedAt)))
      .leftJoin(
        iteration,
        sql`${iteration.id} = coalesce(${tasks.iterationId}, ${parent.iterationId})`,
      )
      .leftJoin(release, eq(release.id, parent.releaseId))
      .where(and(...conditions))
      .orderBy(asc(tasks.rank), asc(tasks.createdAt), asc(tasks.id));

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
        .orderBy(asc(users.displayName), asc(users.id));
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
      .orderBy(asc(users.displayName), asc(users.id));
  }

  async getCapacities(
    iterationId: string,
    userIds: string[],
    teamId: string | null,
  ): Promise<Map<string, number>> {
    if (userIds.length === 0) return new Map();

    /**
     * Keyed on the TEAM as well as the member, and summed rather than overwritten.
     *
     * `uq_member_capacity` is `(project_id, team_id, iteration_id, user_id)`, so a member on two teams
     * has two legitimate rows for one iteration — and a shared, team-less iteration is the normal case
     * here. This read filtered on `iterationId` + `userIds` only and then collapsed the rows into a
     * `Map<userId, hours>`, so the LAST row won, non-deterministically. `upsertCapacity` writes
     * against a team it re-resolves from the iteration, which need not be the row that was displayed,
     * so an edit could overwrite a different team's number than the one on screen. The Phase 6
     * projection already filters by team (`reporting.drizzle-repository.ts`), which is how the two
     * surfaces came to disagree.
     *
     * With a team selected the unique index makes this at most one row per member, so the SUM is that
     * row. Under All Teams — where Team Status groups by MEMBER, not by team — the member's capacity
     * for the iteration is genuinely the total of their per-team allocations, and summing says so
     * instead of picking one at random.
     */
    const rows = await this.db
      .select({
        userId: memberCapacity.userId,
        capacityHours: sql<string>`sum(${memberCapacity.capacityHours})`.as('capacity_hours'),
      })
      .from(memberCapacity)
      .where(
        and(
          eq(memberCapacity.iterationId, iterationId),
          inArray(memberCapacity.userId, userIds),
          teamId ? eq(memberCapacity.teamId, teamId) : undefined,
        ),
      )
      .groupBy(memberCapacity.userId);

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
