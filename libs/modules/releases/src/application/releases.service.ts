import { Inject, Injectable, Logger, NotFoundException, PreconditionFailedException, BadRequestException } from '@nestjs/common';
import { uuidv7 } from 'uuidv7';
import { and, eq, isNull, sql, desc, lt } from 'drizzle-orm';
import { InjectDrizzle, buildPageResult } from '@platform';
import type { JwtPayload, CursorPayload, PagedResult, DrizzleDB } from '@platform';
import { ProjectsService } from '@modules/projects';
import { AccessService } from '@modules/access';
import { PERMISSION } from '@shared-kernel';
import { releaseDailySnapshots, workItems } from '../../../../../db/schema/work';
import { IReleaseRepository, RELEASE_REPOSITORY } from '../domain/ports/release.repository';
import type { Release, UpdateReleaseInput } from '../domain/release.types';

/** Valid release status transitions (Rally-aligned lifecycle). */
const RELEASE_TRANSITIONS: Record<string, string[]> = {
  planning: ['active', 'planning'],
  active: ['accepted', 'planning', 'active'],
  accepted: ['active', 'accepted'],
};

@Injectable()
export class ReleasesService {
  private readonly logger = new Logger(ReleasesService.name);

  constructor(
    @Inject(RELEASE_REPOSITORY) private readonly releaseRepo: IReleaseRepository,
    @InjectDrizzle() private readonly db: DrizzleDB,
    private readonly projectsService: ProjectsService,
    private readonly accessService: AccessService,
  ) {}

  // ── List ──────────────────────────────────────────────────────────────────

  async listReleases(
    actor: JwtPayload,
    projectId: string,
    args: { limit: number; cursor: CursorPayload | null },
  ): Promise<PagedResult<Release>> {
    await this.projectsService.getProject(actor.workspaceId, projectId);
    return this.releaseRepo.listByProject(projectId, actor.workspaceId, args);
  }

  // ── Create ────────────────────────────────────────────────────────────────

  async createRelease(
    actor: JwtPayload,
    projectId: string,
    name: string,
    opts: {
      description?: string;
      theme?: string;
      startDate?: string;
      releaseDate?: string;
      state?: string;
      releaseNotes?: string;
    } = {},
  ): Promise<Release> {
    await this.projectsService.getProject(actor.workspaceId, projectId);

    // Validate date range: releaseDate >= startDate
    if (opts.startDate && opts.releaseDate && opts.releaseDate < opts.startDate) {
      throw new BadRequestException('Release date must be >= start date');
    }

    const release = await this.releaseRepo.create({
      id: uuidv7(),
      workspaceId: actor.workspaceId,
      projectId,
      name,
      description: opts.description,
      theme: opts.theme,
      startDate: opts.startDate,
      releaseDate: opts.releaseDate,
      status: opts.state as Release['status'] ?? 'planning',
      releaseNotes: opts.releaseNotes,
    });

    this.logger.log({ releaseId: release.id, projectId, userId: actor.sub }, 'Release created');
    return release;
  }

  // ── Get ───────────────────────────────────────────────────────────────────

  async getRelease(workspaceId: string, id: string): Promise<Release> {
    const release = await this.releaseRepo.findById(id);
    if (!release || release.workspaceId !== workspaceId) {
      throw new NotFoundException('RELEASE_NOT_FOUND', 'Release not found');
    }
    return release;
  }

  // ── Update ────────────────────────────────────────────────────────────────

  async updateRelease(actor: JwtPayload, id: string, input: UpdateReleaseInput): Promise<Release> {
    const release = await this.getRelease(actor.workspaceId, id);
    // Per-project check: the caller must hold release:manage for THIS release's project.
    await this.accessService.assertProjectPermission(actor, release.projectId, PERMISSION.RELEASE_MANAGE);

    // Validate status transition
    if (input.status && input.status !== release.status) {
      const allowed = RELEASE_TRANSITIONS[release.status] ?? [];
      if (!allowed.includes(input.status)) {
        throw new BadRequestException(
          `Invalid release transition: ${release.status} → ${input.status}. Allowed: ${allowed.join(', ') || 'none (terminal)'}`,
        );
      }
      // Auto-set releasedAt when transitioning to accepted
      if (input.status === 'accepted' && !input.releasedAt) {
        input.releasedAt = new Date();
      }
    }

    // Validate date range: releaseDate >= startDate (using merged values)
    const startDate = input.startDate !== undefined ? input.startDate : release.startDate;
    const releaseDate = input.releaseDate !== undefined ? input.releaseDate : release.releaseDate;
    if (startDate && releaseDate && releaseDate < startDate) {
      throw new BadRequestException('Release date must be >= start date');
    }

    return this.releaseRepo.update(id, input);
  }

  // ── Delete ────────────────────────────────────────────────────────────────

  async deleteRelease(actor: JwtPayload, id: string): Promise<void> {
    const release = await this.getRelease(actor.workspaceId, id);
    await this.accessService.assertProjectPermission(actor, release.projectId, PERMISSION.RELEASE_MANAGE);
    // Accepted releases cannot be deleted
    if (release.status === 'accepted') {
      throw new PreconditionFailedException(
        'RELEASE_NOT_DELETABLE',
        'Accepted releases cannot be deleted',
      );
    }
    await this.releaseRepo.delete(id);
    this.logger.log({ releaseId: id }, 'Release deleted');
  }

  // ── Get Detail (includes task rollup) ─────────────────────────────────────

  async shipRelease(actor: JwtPayload, id: string): Promise<Release> {
    const release = await this.getRelease(actor.workspaceId, id);
    await this.accessService.assertProjectPermission(actor, release.projectId, PERMISSION.RELEASE_MANAGE);
    if (release.status === 'released') {
      throw new PreconditionFailedException('RELEASE_NOT_FOUND', 'Release has already shipped');
    }
    const updated = await this.releaseRepo.update(id, {
      status: 'released',
      releasedAt: new Date(),
    });
    this.logger.log({ releaseId: id }, 'Release shipped');
    return updated;
  }
  async getReleaseDetail(actor: JwtPayload, id: string) {
    const release = await this.getRelease(actor.workspaceId, id);

    // Task rollup: count of stories/defects linked to this release
    const stats = await this.db
      .select({
        totalItems: sql<number>`COUNT(*)`,
        completedItems: sql<number>`COUNT(*) FILTER (WHERE schedule_state IN ('completed', 'accepted', 'released'))`,
        acceptedItems: sql<number>`COUNT(*) FILTER (WHERE schedule_state IN ('accepted', 'released'))`,
        totalPoints: sql<number>`COALESCE(SUM(CASE WHEN story_points IS NOT NULL THEN story_points ELSE 0 END), 0)`,
        completedPoints: sql<number>`COALESCE(SUM(CASE WHEN schedule_state IN ('completed', 'accepted', 'released') THEN story_points ELSE 0 END), 0)`,
      })
      .from(workItems)
      .where(
        and(
          eq(workItems.releaseId, id),
          isNull(workItems.deletedAt),
          sql`type IN ('story', 'defect')`,
        ),
      );

    const s = stats[0];
    const totalPoints = Number(s.totalPoints);
    const completedPoints = Number(s.completedPoints);
    const toDoPoints = totalPoints - completedPoints;
    const toDoItems = s.totalItems - s.completedItems;
    const progressPercent = totalPoints > 0
      ? Math.min(Math.round((completedPoints / totalPoints) * 100), 100)
      : (s.totalItems > 0 && s.completedItems === s.totalItems ? 100 : 0);

    return {
      ...release,
      taskRollup: {
        totalItems: s.totalItems,
        completedItems: s.completedItems,
        acceptedItems: s.acceptedItems,
        toDoItems,
        totalPoints,
        completedPoints,
        toDoPoints,
        progressPercent,
      },
    };
  }

  // ── Release Artifacts (P3) ──────────────────────────────────────────

  /**
   * List work items (stories/defects) linked to a release.
   * Reuses the same shape as the backlog list.
   */
  async listReleaseArtifacts(
    actor: JwtPayload,
    releaseId: string,
    args: { limit: number; cursor: CursorPayload | null },
  ): Promise<PagedResult<{ id: string; itemKey: string; type: string; title: string; scheduleState: string; priority: string; assigneeId: string | null; iterationId: string | null; releaseId: string | null; storyPoints: number | null; createdAt: Date; updatedAt: Date }>> {
    const release = await this.getRelease(actor.workspaceId, releaseId);

    const conditions = [
      eq(workItems.releaseId, releaseId),
      eq(workItems.workspaceId, actor.workspaceId),
      isNull(workItems.deletedAt),
      sql`type IN ('story', 'defect')`,
    ];

    if (args.cursor) {
      conditions.push(lt(workItems.createdAt, new Date(args.cursor.k[0] as string)));
    }

    const rows = await this.db
      .select({
        id: workItems.id,
        itemKey: workItems.itemKey,
        type: workItems.type,
        title: workItems.title,
        scheduleState: workItems.scheduleState,
        priority: workItems.priority,
        assigneeId: workItems.assigneeId,
        iterationId: workItems.iterationId,
        releaseId: workItems.releaseId,
        storyPoints: workItems.storyPoints,
        createdAt: workItems.createdAt,
        updatedAt: workItems.updatedAt,
      })
      .from(workItems)
      .where(and(...conditions))
      .orderBy(desc(workItems.createdAt))
      .limit(args.limit + 1);

    return buildPageResult(rows as any[], args.limit, (w) => [w.createdAt.toISOString()]);
  }

  // ── Burndown ─────────────────────────────────────────────────────────────

  async getReleaseBurndown(workspaceId: string, releaseId: string) {
    const release = await this.releaseRepo.findById(releaseId);
    if (!release || release.workspaceId !== workspaceId) {
      throw new NotFoundException('Release not found');
    }

    const snapshots = await this.db
      .select()
      .from(releaseDailySnapshots)
      .where(eq(releaseDailySnapshots.releaseId, releaseId))
      .orderBy(releaseDailySnapshots.snapshotDate);

    return snapshots.map((s) => ({
      date: s.snapshotDate,
      totalPoints: Number(s.totalPoints),
      completedPoints: Number(s.completedPoints),
      remainingPoints: Number(s.remainingPoints),
      totalItems: s.totalItems,
      completedItems: s.completedItems,
    }));
  }

  // ── Snapshot upsert (called by cron) ─────────────────────────────────────

  async upsertReleaseSnapshot(releaseId: string): Promise<void> {
    const today = new Date().toISOString().split('T')[0];

    const stats = await this.db
      .select({
        totalPoints: sql<number>`COALESCE(SUM(CASE WHEN story_points IS NOT NULL THEN story_points ELSE 0 END), 0)`,
        completedPoints: sql<number>`COALESCE(SUM(CASE WHEN schedule_state IN ('completed', 'accepted', 'released') THEN story_points ELSE 0 END), 0)`,
        totalItems: sql<number>`COUNT(*)`,
        completedItems: sql<number>`COUNT(*) FILTER (WHERE schedule_state IN ('completed', 'accepted', 'released'))`,
      })
      .from(workItems)
      .where(
        and(
          eq(workItems.releaseId, releaseId),
          isNull(workItems.deletedAt),
          sql`type IN ('story', 'defect')`,
        ),
      );

    const s = stats[0];
    const total = String(s.totalPoints);
    const completed = String(s.completedPoints);
    const remaining = String(Number(s.totalPoints) - Number(s.completedPoints));

    await this.db
      .insert(releaseDailySnapshots)
      .values({
        releaseId,
        snapshotDate: today,
        totalPoints: total,
        completedPoints: completed,
        remainingPoints: remaining,
        totalItems: s.totalItems,
        completedItems: s.completedItems,
      })
      .onConflictDoUpdate({
        target: [releaseDailySnapshots.releaseId, releaseDailySnapshots.snapshotDate],
        set: {
          totalPoints: total,
          completedPoints: completed,
          remainingPoints: remaining,
          totalItems: s.totalItems,
          completedItems: s.completedItems,
        },
      });
  }
}