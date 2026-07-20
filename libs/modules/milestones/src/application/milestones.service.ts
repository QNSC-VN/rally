import { Inject, Injectable, Logger } from '@nestjs/common';
import { uuidv7 } from 'uuidv7';
import { InjectDrizzle, NotFoundException, PreconditionFailedException } from '@platform';
import type { JwtPayload, CursorPayload, PagedResult, DrizzleDB } from '@platform';
import { and, eq, isNull, sql, inArray } from 'drizzle-orm';
import { ProjectsService } from '@modules/projects';
import { AccessService } from '@modules/access';
import { PERMISSION } from '@shared-kernel';
import {
  workItems,
  milestones,
  milestoneReleases,
  releases,
  projects,
  teams,
} from '../../../../../db/schema/work';
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

/**
 * Valid status transitions. SRS FR-006 enumerates the milestone statuses but
 * does not prescribe a transition graph, so we keep the lifecycle permissive:
 * any status may move to any OTHER status, with `completed` as the single
 * terminal state (a completed milestone is done and cannot be reopened). This
 * avoids trapping users in the previous restrictive graph (e.g. a `met`
 * milestone that could only go to `completed`) while still preventing the one
 * invariant the product needs — no resurrection of a completed milestone.
 * NOTE for BA sign-off: confirm whether any additional terminal/locked states
 * are required; this graph is intentionally the least-restrictive safe default.
 */
const ALL_MILESTONE_STATUSES: MilestoneStatus[] = [
  'planned',
  'at_risk',
  'met',
  'missed',
  'cancelled',
  'completed',
];
const others = (self: MilestoneStatus): MilestoneStatus[] =>
  ALL_MILESTONE_STATUSES.filter((s) => s !== self);
const MILESTONE_TRANSITIONS: Record<MilestoneStatus, MilestoneStatus[]> = {
  planned: others('planned'),
  at_risk: others('at_risk'),
  met: others('met'),
  missed: others('missed'),
  cancelled: others('cancelled'),
  completed: [], // terminal — a completed milestone cannot be reopened
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

  /**
   * Single guard that every milestone link write funnels through: the linked
   * projects, teams and releases must all belong to the actor's workspace.
   * Mirrors the tenant-isolation rule enforced for project\u2194team links
   * (ProjectsService.linkTeam) so a milestone can never reference an entity
   * from another workspace/tenant. Each set is validated with one COUNT query;
   * a size mismatch means at least one id is foreign (or does not exist).
   */
  private async assertLinksInWorkspace(
    workspaceId: string,
    links: { projectIds?: string[]; teamIds?: string[]; releaseIds?: string[] },
  ): Promise<void> {
    const projectIds = [...new Set(links.projectIds ?? [])];
    const teamIds = [...new Set(links.teamIds ?? [])];
    const releaseIds = [...new Set(links.releaseIds ?? [])];

    if (projectIds.length > 0) {
      const rows = await this.db
        .select({ id: projects.id })
        .from(projects)
        .where(
          and(
            inArray(projects.id, projectIds),
            eq(projects.workspaceId, workspaceId),
            isNull(projects.deletedAt),
          ),
        );
      if (rows.length !== projectIds.length) {
        throw new PreconditionFailedException(
          'MILESTONE_PROJECT_NOT_IN_WORKSPACE',
          'One or more projects do not belong to this workspace',
        );
      }
    }

    if (teamIds.length > 0) {
      const rows = await this.db
        .select({ id: teams.id })
        .from(teams)
        .where(and(inArray(teams.id, teamIds), eq(teams.workspaceId, workspaceId)));
      if (rows.length !== teamIds.length) {
        throw new PreconditionFailedException(
          'MILESTONE_TEAM_NOT_IN_WORKSPACE',
          'One or more teams do not belong to this workspace',
        );
      }
    }

    if (releaseIds.length > 0) {
      const rows = await this.db
        .select({ id: releases.id })
        .from(releases)
        .where(and(inArray(releases.id, releaseIds), eq(releases.workspaceId, workspaceId)));
      if (rows.length !== releaseIds.length) {
        throw new PreconditionFailedException(
          'MILESTONE_RELEASE_NOT_IN_WORKSPACE',
          'One or more releases do not belong to this workspace',
        );
      }
    }
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

    // Tenant isolation: every linked project/team/release must live in this
    // workspace before we persist any link (defense in depth beyond RLS).
    await this.assertLinksInWorkspace(actor.workspaceId, {
      projectIds: opts.projectIds,
      teamIds: opts.teamIds,
      releaseIds: opts.releaseIds,
    });

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
      await this.assertLinksInWorkspace(actor.workspaceId, { releaseIds: input.releaseIds });
      await this.milestoneRepo.setReleaseLinks(id, input.releaseIds);
      await this.recalcTargetDates(id, actor.workspaceId);
    }
    if (input.projectIds !== undefined) {
      await this.assertLinksInWorkspace(actor.workspaceId, { projectIds: input.projectIds });
      await this.milestoneRepo.setProjectLinks(id, input.projectIds);
    }
    if (input.teamIds !== undefined) {
      await this.assertLinksInWorkspace(actor.workspaceId, { teamIds: input.teamIds });
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
    const uniqueIds = [...new Set(workItemIds)];
    if (uniqueIds.length > 0) {
      // Milestone scope per SRS §5.2 / FR-021/023: an artifact must belong to
      // one of the milestone's selected Projects and, when Team scope is
      // selected, one of its selected Teams. The owning project is always part
      // of the project scope alongside any additionally linked projects.
      const projectScope = new Set<string>([milestone.projectId, ...(milestone.projectIds ?? [])]);
      const teamScope = milestone.teamIds ?? [];
      const rows = await this.db
        .select({
          id: workItems.id,
          projectId: workItems.projectId,
          teamId: workItems.teamId,
          type: workItems.type,
        })
        .from(workItems)
        .where(
          and(
            inArray(workItems.id, uniqueIds),
            eq(workItems.workspaceId, actor.workspaceId),
            isNull(workItems.deletedAt),
          ),
        );
      if (rows.length !== uniqueIds.length || rows.some((r) => !projectScope.has(r.projectId))) {
        throw new PreconditionFailedException(
          'MILESTONE_PROJECT_MISMATCH',
          'One or more work items do not belong to this milestone\u2019s project scope',
        );
      }
      // SRS §5.1 / FR-014: a Milestone Artifact is a Story or Defect work item.
      // Reject initiatives, features and tasks so the Artifacts dashboard stays
      // the Backlog-shaped Story/Defect list the BA specified.
      if (rows.some((r) => r.type !== 'story' && r.type !== 'defect')) {
        throw new PreconditionFailedException(
          'MILESTONE_INVALID_ARTIFACT_TYPE',
          'Only stories and defects can be assigned as milestone artifacts',
        );
      }
      if (teamScope.length > 0) {
        const teamSet = new Set(teamScope);
        if (rows.some((r) => r.teamId === null || !teamSet.has(r.teamId))) {
          throw new PreconditionFailedException(
            'MILESTONE_TEAM_MISMATCH',
            'One or more work items are outside this milestone\u2019s team scope',
          );
        }
      }
    }
    await this.milestoneRepo.setArtifactLinks(milestoneId, uniqueIds);
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
    await this.assertLinksInWorkspace(actor.workspaceId, { projectIds });
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
    await this.assertLinksInWorkspace(actor.workspaceId, { teamIds });
    await this.milestoneRepo.setTeamLinks(milestoneId, teamIds);
    return this.milestoneRepo.getTeamIds(milestoneId);
  }

  async getMilestoneReleases(actor: JwtPayload, milestoneId: string): Promise<string[]> {
    await this.getMilestone(actor.workspaceId, milestoneId);
    return this.milestoneRepo.getReleaseIds(milestoneId);
  }

  async setMilestoneReleases(
    actor: JwtPayload,
    milestoneId: string,
    releaseIds: string[],
  ): Promise<string[]> {
    const milestone = await this.getMilestone(actor.workspaceId, milestoneId);
    await this.accessService.assertProjectPermission(
      actor,
      milestone.projectId,
      PERMISSION.MILESTONE_EDIT,
    );
    await this.assertLinksInWorkspace(actor.workspaceId, { releaseIds });
    await this.milestoneRepo.setReleaseLinks(milestoneId, releaseIds);
    // Target dates are derived from the linked releases (SRS FR-011/012), so
    // recompute them whenever the release set changes.
    await this.recalcTargetDates(milestoneId, actor.workspaceId);
    return this.milestoneRepo.getReleaseIds(milestoneId);
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
