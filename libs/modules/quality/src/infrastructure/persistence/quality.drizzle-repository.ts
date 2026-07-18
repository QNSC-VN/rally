import { Injectable } from '@nestjs/common';
import { InjectDrizzle } from '@platform';
import type { DrizzleDB } from '@platform';
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import type { SQL, SQLWrapper } from 'drizzle-orm';
import { workItems, iterations, releases } from '../../../../../../db/schema/work';
import {
  isCompletedScheduleState,
  isOpenDefectScheduleState,
} from '../../../../../../db/schema/enums';
import type {
  DefectSeverity,
  DefectEnvironment,
  DefectRootCause,
  DefectResolution,
  DefectState,
  WorkItemPriority,
  WorkItemScheduleState,
} from '../../../../../../db/schema/enums';
import type {
  DefectMetrics,
  DefectRow,
  ListDefectsOptions,
  QualitySortBy,
} from '../../domain/quality.types';
import { IQualityRepository } from '../../domain/ports/quality.repository';

@Injectable()
export class QualityDrizzleRepository implements IQualityRepository {
  constructor(@InjectDrizzle() private readonly db: DrizzleDB) {}

  async listDefects(
    workspaceId: string,
    projectId: string,
    opts: ListDefectsOptions = {},
  ): Promise<{ rows: DefectRow[] }> {
    const conditions = [
      eq(workItems.workspaceId, workspaceId),
      eq(workItems.projectId, projectId),
      eq(workItems.type, 'defect'),
      isNull(workItems.deletedAt),
    ];

    if (opts.severity && opts.severity !== 'all') {
      conditions.push(eq(workItems.severity, opts.severity as DefectSeverity));
    }
    if (opts.environment && opts.environment !== 'all') {
      conditions.push(eq(workItems.foundInEnvironment, opts.environment as DefectEnvironment));
    }
    if (opts.priority && opts.priority !== 'all') {
      conditions.push(eq(workItems.priority, opts.priority as WorkItemPriority));
    }
    if (opts.scheduleState && opts.scheduleState !== 'all') {
      conditions.push(eq(workItems.scheduleState, opts.scheduleState as WorkItemScheduleState));
    }
    if (opts.assigneeId) {
      conditions.push(eq(workItems.assigneeId, opts.assigneeId));
    }
    if (opts.releaseId) {
      conditions.push(eq(workItems.releaseId, opts.releaseId));
    }
    if (opts.rootCause && opts.rootCause !== 'all') {
      conditions.push(eq(workItems.rootCause, opts.rootCause as DefectRootCause));
    }
    if (opts.resolution === 'unresolved') {
      conditions.push(isNull(workItems.resolution));
    } else if (opts.resolution && opts.resolution !== 'all') {
      conditions.push(eq(workItems.resolution, opts.resolution as DefectResolution));
    }
    if (opts.defectState && opts.defectState !== 'all') {
      conditions.push(eq(workItems.defectState, opts.defectState as DefectState));
    }
    if (opts.search) {
      conditions.push(sql`work_items.title ILIKE ${`%${opts.search}%`}`);
    }

    const limit = Math.min(opts.limit ?? 100, 200);
    const offset = opts.offset ?? 0;

    // Sortable columns → SQL expression. Enum columns sort by their semantic
    // Postgres declaration order; joined columns (names/parent) sort by the
    // joined value. Keyed by the FE column id so the two stay in lock-step.
    const sortColumns: Record<QualitySortBy, SQLWrapper> = {
      id: workItems.itemKey,
      name: workItems.title,
      userStory: sql`parent_wi.item_key`,
      severity: workItems.severity,
      priority: workItems.priority,
      state: workItems.defectState,
      scheduleState: workItems.scheduleState,
      fixedInBuild: workItems.fixedInBuild,
      iteration: iterations.name,
      submittedBy: sql`creator_user.display_name`,
      owner: sql`assignee_user.display_name`,
    };
    const dir = opts.sortDirection === 'desc' ? desc : asc;
    // Default (no explicit sort) keeps the natural backlog rank order; an
    // explicit sort leads, with rank as a stable tie-breaker.
    const orderBy: SQL[] = opts.sortBy
      ? [dir(sortColumns[opts.sortBy]), asc(workItems.rank)]
      : [asc(workItems.rank), asc(workItems.createdAt)];

    const rows = await this.db
      .select({
        id: workItems.id,
        itemKey: workItems.itemKey,
        title: workItems.title,
        type: workItems.type,
        priority: workItems.priority,
        severity: workItems.severity,
        foundInEnvironment: workItems.foundInEnvironment,
        rootCause: workItems.rootCause,
        resolution: workItems.resolution,
        foundInReleaseId: workItems.foundInReleaseId,
        assigneeId: workItems.assigneeId,
        scheduleState: workItems.scheduleState,
        iterationId: workItems.iterationId,
        releaseId: workItems.releaseId,
        parentId: workItems.parentId,
        isBlocked: workItems.isBlocked,
        rank: workItems.rank,
        defectState: workItems.defectState,
        fixedInBuild: workItems.fixedInBuild,
        createdById: workItems.createdBy,
        createdAt: workItems.createdAt,
        updatedAt: workItems.updatedAt,
        iterationName: iterations.name,
        releaseName: releases.name,
        foundInReleaseName: sql<string>`found_in_release.name`,
        parentKey: sql<string>`parent_wi.item_key`,
        parentTitle: sql<string>`parent_wi.title`,
        assigneeName: sql<string | null>`assignee_user.display_name`,
        createdByName: sql<string | null>`creator_user.display_name`,
      })
      .from(workItems)
      .leftJoin(iterations, eq(workItems.iterationId, iterations.id))
      .leftJoin(releases, eq(workItems.releaseId, releases.id))
      .leftJoin(
        sql`work.releases found_in_release`,
        sql`found_in_release.id = work_items.found_in_release_id`,
      )
      .leftJoin(sql`work.work_items parent_wi`, sql`parent_wi.id = work_items.parent_id`)
      .leftJoin(sql`identity.users assignee_user`, sql`assignee_user.id = work_items.assignee_id`)
      .leftJoin(sql`identity.users creator_user`, sql`creator_user.id = work_items.created_by`)
      .where(and(...conditions))
      .orderBy(...orderBy)
      .limit(limit)
      .offset(offset);

    const data: DefectRow[] = rows.map((r) => ({
      id: r.id,
      itemKey: r.itemKey,
      title: r.title,
      type: r.type,
      priority: r.priority,
      severity: r.severity,
      foundInEnvironment: r.foundInEnvironment,
      rootCause: r.rootCause,
      resolution: r.resolution,
      foundInReleaseId: r.foundInReleaseId,
      foundInReleaseName: r.foundInReleaseName,
      assigneeId: r.assigneeId,
      assigneeName: r.assigneeName,
      scheduleState: r.scheduleState,
      iterationId: r.iterationId,
      iterationName: r.iterationName,
      releaseId: r.releaseId,
      releaseName: r.releaseName,
      parentId: r.parentId,
      parentKey: r.parentKey,
      parentTitle: r.parentTitle,
      isBlocked: r.isBlocked,
      rank: r.rank,
      defectState: r.defectState,
      fixedInBuild: r.fixedInBuild,
      createdById: r.createdById,
      createdByName: r.createdByName,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }));

    return { rows: data };
  }

  async computeMetrics(workspaceId: string, projectId: string): Promise<DefectMetrics> {
    const rows = await this.db
      .select({
        scheduleState: workItems.scheduleState,
        severity: workItems.severity,
        isBlocked: workItems.isBlocked,
        resolution: workItems.resolution,
        createdAt: workItems.createdAt,
        updatedAt: workItems.updatedAt,
      })
      .from(workItems)
      .where(
        and(
          eq(workItems.workspaceId, workspaceId),
          eq(workItems.projectId, projectId),
          eq(workItems.type, 'defect'),
          isNull(workItems.deletedAt),
        ),
      );

    let openDefects = 0;
    let critical = 0;
    let inProgress = 0;
    let verifiedAccepted = 0;
    let reopened = 0;
    let blockers = 0;

    // Open = actionable in-flight defect states (excludes `idea` backlog and
    // completed/accepted). Canonical set lives in db/schema/enums.ts.
    const isOpen = isOpenDefectScheduleState;
    const isCompleted = isCompletedScheduleState;

    for (const r of rows) {
      if (isOpen(r.scheduleState)) openDefects++;
      if (r.severity === 'critical') critical++;
      if (r.scheduleState === 'in_progress') inProgress++;
      if (isCompleted(r.scheduleState)) verifiedAccepted++;
      if (r.isBlocked) blockers++;

      // Reopened heuristic: has a resolution set but is back in an open state.
      if (r.resolution && isOpen(r.scheduleState)) reopened++;
    }

    return { openDefects, critical, inProgress, verifiedAccepted, reopened, blockers };
  }
}
