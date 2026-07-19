import { Inject, Injectable, Logger } from '@nestjs/common';
import { uuidv7 } from 'uuidv7';
import { InjectDrizzle, NotFoundException, PreconditionFailedException } from '@platform';
import type { JwtPayload, CursorPayload, PagedResult, DrizzleDB } from '@platform';
import { and, eq, isNull, sql, inArray } from 'drizzle-orm';
import { ProjectsService } from '@modules/projects';
import { AccessService } from '@modules/access';
import { PERMISSION } from '@shared-kernel';
import { workItems, milestones, milestoneReleases, releases } from '../../../../../db/schema/work';
import { completedScheduleStatesSql } from '../../../../../db/schema/enums';
import { IMilestoneRepository, MILESTONE_REPOSITORY } from '../domain/ports/milestone.repository';
import type { Milestone, MilestoneStatus, UpdateMilestoneInput } from '../domain/milestone.types';

export interface MilestoneProgress {
  totalItems: number;
  completedItems: number;
  totalPoints: number;
  completedPoints: number;
  progressPercent: number;
}

interface ReleaseStats {
  totalItems: number;
  completedItems: number;
  totalPoints: number;
  completedPoints: number;
}

/** Valid status transitions (Rally-aligned lifecycle). */
const MILESTONE_TRANSITIONS: Record<MilestoneStatus, MilestoneStatus[]> = {
  planned: ['at_risk', 'completed', 'cancelled'],
  at_risk: ['planned', 'met', 'missed', 'cancelled'],
  met: ['completed'],
  missed: ['at_risk', 'cancelled'],
  cancelled: ['planned'],
  completed: [],
};

@Injectable()
export class MilestonesService {
  private readonly logger = new Logger(MilestonesService.name);

  constructor(
    @Inject(MILESTONE_REPOSITORY) private readonly milestoneRepo: IMilestoneRepository,
    @InjectDrizzle() private readonly db: DrizzleDB,
    private readonly projectsService: ProjectsService,
    private readonly accessService: AccessService,
  ) {}

  // ── List ──────────────────────────────────────────────────────────────────

  async listMilestones(
    actor: JwtPayload,
    projectId: string,
    args: { limit: number; cursor: CursorPayload | null },
  ): Promise<PagedResult<Milestone & { progress?: MilestoneProgress }>> {
    await this.projectsService.getProject(actor.workspaceId, projectId);
    const page = await this.milestoneRepo.listByProject(projectId, actor.workspaceId, args);

    const progressByMilestone = await this.computeProgressBatch(page.data);
    return {
      ...page,
      data: page.data.map((m) => ({ ...m, progress: progressByMilestone.get(m.id) ?? undefined })),
    };
  }

  // ── Recalculate target dates from linked releases ──────────────────────

  /**
   * Recompute targetStartDate / targetEndDate from linked releases and
   * persist the result.  If no releases are linked, sets both to null.
   */
  private async recalcTargetDates(milestoneId: string, workspaceId: string): Promise<void> {
    const result = await this.db
      .select({
        startDate: sql<string | null>`MIN(${releases.startDate})`,
        endDate: sql<string | null>`MAX(${releases.releaseDate})`,
      })
      .from(milestoneReleases)
      .innerJoin(releases, eq(milestoneReleases.releaseId, releases.id))
      .where(
        and(eq(milestoneReleases.milestoneId, milestoneId), eq(releases.workspaceId, workspaceId)),
      );

    const { startDate, endDate } = result[0] ?? { startDate: null, endDate: null };

    await this.db
      .update(milestones)
      .set({ targetStartDate: startDate, targetEndDate: endDate, updatedAt: new Date() })
      .where(eq(milestones.id, milestoneId));
  }

  // ── Create ────────────────────────────────────────────────────────────────

  async createMilestone(
    actor: JwtPayload,
    projectId: string,
    name: string,
    opts: {
      description?: string;
      notes?: string;
      status?: string;
      ownerId?: string;
      targetStartDate?: string;
      targetEndDate?: string;
      releaseIds?: string[];
      projectIds?: string[];
      teamIds?: string[];
    } = {},
  ): Promise<Milestone> {
    await this.projectsService.getProject(actor.workspaceId, projectId);

    const releaseIds = opts.releaseIds ?? [];

    const milestone = await this.milestoneRepo.create({
      id: uuidv7(),
      workspaceId: actor.workspaceId,
      projectId,
      name,
      description: opts.description,
      notes: opts.notes,
      status: (opts.status as MilestoneStatus) ?? 'planned',
      ownerId: opts.ownerId,
      releaseIds,
      projectIds: opts.projectIds,
      teamIds: opts.teamIds,
    });

    if (releaseIds.length > 0) {
      await this.milestoneRepo.setReleaseLinks(milestone.id, releaseIds);
    }
    if (opts.projectIds?.length) {
      await this.milestoneRepo.setProjectLinks(milestone.id, opts.projectIds);
    }
    if (opts.teamIds?.length) {
      await this.milestoneRepo.setTeamLinks(milestone.id, opts.teamIds);
    }

    // Always derive target dates from linked releases (read-only computed fields)
    await this.recalcTargetDates(milestone.id, actor.workspaceId);

    const final = await this.milestoneRepo.findById(milestone.id);
    this.logger.log(
      { milestoneId: milestone.id, projectId, userId: actor.sub },
      'Milestone created',
    );
    return final!;
  }

  // ── Get ───────────────────────────────────────────────────────────────────

  async getMilestone(
    workspaceId: string,
    id: string,
  ): Promise<Milestone & { progress?: MilestoneProgress }> {
    const milestone = await this.milestoneRepo.findById(id);
    if (!milestone || milestone.workspaceId !== workspaceId) {
      throw new NotFoundException('MILESTONE_NOT_FOUND', 'Milestone not found');
    }

    // Ensure target dates are always derived from linked releases
    await this.recalcTargetDates(id, workspaceId);
    const refreshed = await this.milestoneRepo.findById(id);

    // Compute progress from work items linked to this milestone's releases
    const progress = await this.computeProgress(refreshed!.releaseIds);
    return { ...refreshed!, progress: progress ?? undefined };
  }

  /**
   * Compute progress across all releases linked to a milestone.
   */
  private async computeProgress(releaseIds: string[]): Promise<MilestoneProgress | null> {
    if (releaseIds.length === 0) return null;
    const byRelease = await this.fetchReleaseStats(releaseIds);
    return this.aggregateProgress(releaseIds, byRelease);
  }

  /**
   * Compute progress for many milestones at once (one query for all releases
   * involved, instead of N+1 per-milestone queries on the list page).
   */
  private async computeProgressBatch(
    milestones: Milestone[],
  ): Promise<Map<string, MilestoneProgress>> {
    const allReleaseIds = [...new Set(milestones.flatMap((m) => m.releaseIds))];
    const byRelease = await this.fetchReleaseStats(allReleaseIds);

    const result = new Map<string, MilestoneProgress>();
    for (const m of milestones) {
      const progress = this.aggregateProgress(m.releaseIds, byRelease);
      if (progress) result.set(m.id, progress);
    }
    return result;
  }

  /** Per-release work-item stats, grouped by `releaseId`. */
  private async fetchReleaseStats(releaseIds: string[]): Promise<Map<string, ReleaseStats>> {
    if (releaseIds.length === 0) return new Map();

    const stats = await this.db
      .select({
        releaseId: workItems.releaseId,
        totalItems: sql<number>`COUNT(*)`,
        completedItems: sql<number>`COUNT(*) FILTER (WHERE schedule_state IN (${completedScheduleStatesSql()}))`,
        totalPoints: sql<number>`COALESCE(SUM(CASE WHEN story_points IS NOT NULL THEN story_points ELSE 0 END), 0)`,
        completedPoints: sql<number>`COALESCE(SUM(CASE WHEN schedule_state IN (${completedScheduleStatesSql()}) THEN story_points ELSE 0 END), 0)`,
      })
      .from(workItems)
      .where(
        and(
          inArray(workItems.releaseId, releaseIds),
          isNull(workItems.deletedAt),
          sql`type IN ('story', 'defect')`,
        ),
      )
      .groupBy(workItems.releaseId);

    return new Map(
      stats.filter((s) => s.releaseId !== null).map((s) => [s.releaseId as string, s]),
    );
  }

  private aggregateProgress(
    releaseIds: string[],
    byRelease: Map<string, ReleaseStats>,
  ): MilestoneProgress | null {
    if (releaseIds.length === 0) return null;

    let totalItems = 0;
    let completedItems = 0;
    let totalPoints = 0;
    let completedPoints = 0;
    for (const releaseId of releaseIds) {
      const s = byRelease.get(releaseId);
      if (!s) continue;
      totalItems += Number(s.totalItems);
      completedItems += Number(s.completedItems);
      totalPoints += Number(s.totalPoints);
      completedPoints += Number(s.completedPoints);
    }

    const progressPercent =
      totalPoints > 0
        ? Math.min(Math.round((completedPoints / totalPoints) * 100), 100)
        : totalItems > 0 && completedItems === totalItems
          ? 100
          : 0;

    return { totalItems, completedItems, totalPoints, completedPoints, progressPercent };
  }

  // ── Update ────────────────────────────────────────────────────────────────

  async updateMilestone(
    actor: JwtPayload,
    id: string,
    input: UpdateMilestoneInput,
  ): Promise<Milestone> {
    const milestone = await this.getMilestone(actor.workspaceId, id);
    await this.accessService.assertProjectPermission(
      actor,
      milestone.projectId,
      PERMISSION.MILESTONE_EDIT,
    );

    // Validate status transition
    if (input.status && input.status !== milestone.status) {
      const allowed = MILESTONE_TRANSITIONS[milestone.status] ?? [];
      if (!allowed.includes(input.status)) {
        throw new PreconditionFailedException(
          'MILESTONE_INVALID_TRANSITION',
          `Invalid milestone transition: ${milestone.status} → ${input.status}. Allowed: ${allowed.join(', ') || 'none (terminal)'}`,
        );
      }
    }

    // If releaseIds changed, always recalculate target dates from releases
    if (input.releaseIds !== undefined) {
      await this.milestoneRepo.setReleaseLinks(id, input.releaseIds);
      await this.recalcTargetDates(id, actor.workspaceId);
    }
    if (input.projectIds !== undefined) {
      await this.milestoneRepo.setProjectLinks(id, input.projectIds);
    }
    if (input.teamIds !== undefined) {
      await this.milestoneRepo.setTeamLinks(id, input.teamIds);
    }

    // Target dates are read-only (derived); strip any client-supplied values
    delete input.targetStartDate;
    delete input.targetEndDate;

    const updated = await this.milestoneRepo.update(id, input);
    const [releaseIds, projectIds, teamIds] = await Promise.all([
      this.milestoneRepo.getReleaseIds(id),
      this.milestoneRepo.getProjectIds(id),
      this.milestoneRepo.getTeamIds(id),
    ]);
    return { ...updated, releaseIds, projectIds, teamIds };
  }

  // ── Artifact management (P3.3) ──────────────────────────────────────

  async getMilestoneArtifacts(actor: JwtPayload, milestoneId: string): Promise<string[]> {
    await this.getMilestone(actor.workspaceId, milestoneId);
    return this.milestoneRepo.getArtifactIds(milestoneId);
  }

  async setMilestoneArtifacts(
    actor: JwtPayload,
    milestoneId: string,
    workItemIds: string[],
  ): Promise<string[]> {
    const milestone = await this.getMilestone(actor.workspaceId, milestoneId);
    await this.accessService.assertProjectPermission(
      actor,
      milestone.projectId,
      PERMISSION.MILESTONE_EDIT,
    );
    await this.milestoneRepo.setArtifactLinks(milestoneId, workItemIds);
    return this.milestoneRepo.getArtifactIds(milestoneId);
  }

  async getMilestoneProjects(actor: JwtPayload, milestoneId: string): Promise<string[]> {
    await this.getMilestone(actor.workspaceId, milestoneId);
    return this.milestoneRepo.getProjectIds(milestoneId);
  }

  async setMilestoneProjects(
    actor: JwtPayload,
    milestoneId: string,
    projectIds: string[],
  ): Promise<string[]> {
    const milestone = await this.getMilestone(actor.workspaceId, milestoneId);
    await this.accessService.assertProjectPermission(
      actor,
      milestone.projectId,
      PERMISSION.MILESTONE_EDIT,
    );
    await this.milestoneRepo.setProjectLinks(milestoneId, projectIds);
    return this.milestoneRepo.getProjectIds(milestoneId);
  }

  async getMilestoneTeams(actor: JwtPayload, milestoneId: string): Promise<string[]> {
    await this.getMilestone(actor.workspaceId, milestoneId);
    return this.milestoneRepo.getTeamIds(milestoneId);
  }

  async setMilestoneTeams(
    actor: JwtPayload,
    milestoneId: string,
    teamIds: string[],
  ): Promise<string[]> {
    const milestone = await this.getMilestone(actor.workspaceId, milestoneId);
    await this.accessService.assertProjectPermission(
      actor,
      milestone.projectId,
      PERMISSION.MILESTONE_EDIT,
    );
    await this.milestoneRepo.setTeamLinks(milestoneId, teamIds);
    return this.milestoneRepo.getTeamIds(milestoneId);
  }

  // ── Delete ────────────────────────────────────────────────────────────────

  async deleteMilestone(actor: JwtPayload, id: string): Promise<void> {
    const milestone = await this.getMilestone(actor.workspaceId, id);
    await this.accessService.assertProjectPermission(
      actor,
      milestone.projectId,
      PERMISSION.MILESTONE_DELETE,
    );
    await this.milestoneRepo.delete(id);
    this.logger.log({ milestoneId: id }, 'Milestone deleted');
  }
}
