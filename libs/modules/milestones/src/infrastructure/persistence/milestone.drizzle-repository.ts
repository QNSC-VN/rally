import { Injectable } from '@nestjs/common';
import { and, asc, eq, sql, inArray } from 'drizzle-orm';
import { InjectDrizzle, buildPageResult, keysetCondition } from '@platform';
import type { DrizzleDB, CursorPayload, PagedResult } from '@platform';
import {
  milestones,
  milestoneReleases,
  milestoneProjects,
  milestoneTeams,
  milestoneArtifacts,
  releases,
} from '../../../../../../db/schema/work';
import type {
  Milestone,
  MilestoneOption,
  CreateMilestoneInput,
  UpdateMilestoneInput,
} from '../../domain/milestone.types';
import {
  IMilestoneRepository,
  type MilestoneArtifactLink,
} from '../../domain/ports/milestone.repository';

@Injectable()
export class MilestoneDrizzleRepository implements IMilestoneRepository {
  constructor(@InjectDrizzle() private readonly db: DrizzleDB) {}

  async findById(id: string): Promise<Milestone | null> {
    const rows = await this.db.select().from(milestones).where(eq(milestones.id, id)).limit(1);
    if (!rows[0]) return null;
    const [releaseIds, projectIds, teamIds] = await Promise.all([
      this.getReleaseIds(id),
      this.getProjectIds(id),
      this.getTeamIds(id),
    ]);
    return { ...rows[0], releaseIds, projectIds, teamIds };
  }

  async listByProject(
    projectId: string,
    workspaceId: string,
    { limit, cursor }: { limit: number; cursor: CursorPayload | null },
  ): Promise<PagedResult<Milestone>> {
    const conditions = [
      eq(milestones.projectId, projectId),
      eq(milestones.workspaceId, workspaceId),
    ];
    if (cursor) {
      conditions.push(keysetCondition(milestones.createdAt, milestones.id, cursor));
    }

    const rows = await this.db
      .select()
      .from(milestones)
      .where(and(...conditions))
      .orderBy(asc(milestones.createdAt), asc(milestones.id))
      .limit(limit + 1);

    // Batch-fetch release IDs for ALL milestones in a single query (fixes N+1)
    const milestoneIds = rows.map((r) => r.id);
    const releaseMap: Record<string, string[]> = {};
    if (milestoneIds.length > 0) {
      const links = await this.db
        .select({
          milestoneId: milestoneReleases.milestoneId,
          releaseId: milestoneReleases.releaseId,
        })
        .from(milestoneReleases)
        .where(inArray(milestoneReleases.milestoneId, milestoneIds));
      for (const link of links) {
        if (!releaseMap[link.milestoneId]) releaseMap[link.milestoneId] = [];
        releaseMap[link.milestoneId].push(link.releaseId);
      }
    }

    const withReleases = rows.map((row) => ({
      ...row,
      releaseIds: releaseMap[row.id] ?? [],
    }));

    return buildPageResult(withReleases as Milestone[], limit, (r) => [r.createdAt.toISOString()]);
  }

  /**
   * The reference feed. Its own `select` of four columns plus the release links, deliberately —
   * `select()` would read the whole record and put the administration fields one `map` away from the
   * widest-audience response. Unpaged: a picker that offers a page of a project's milestones is the
   * defect this feed exists to fix.
   */
  async listOptionsByProject(projectId: string, workspaceId: string): Promise<MilestoneOption[]> {
    const rows = await this.db
      .select({
        id: milestones.id,
        projectId: milestones.projectId,
        milestoneKey: milestones.milestoneKey,
        name: milestones.name,
      })
      .from(milestones)
      .where(and(eq(milestones.projectId, projectId), eq(milestones.workspaceId, workspaceId)))
      .orderBy(asc(milestones.name), asc(milestones.id));
    if (rows.length === 0) return [];

    // One batched link query, the same shape `listByProject` uses — never per row.
    const links = await this.db
      .select({
        milestoneId: milestoneReleases.milestoneId,
        releaseId: milestoneReleases.releaseId,
      })
      .from(milestoneReleases)
      .where(
        inArray(
          milestoneReleases.milestoneId,
          rows.map((r) => r.id),
        ),
      );
    const byMilestone = new Map<string, string[]>();
    for (const link of links) {
      const list = byMilestone.get(link.milestoneId) ?? [];
      list.push(link.releaseId);
      byMilestone.set(link.milestoneId, list);
    }
    return rows.map((r) => ({ ...r, releaseIds: byMilestone.get(r.id) ?? [] }));
  }

  async create(input: CreateMilestoneInput): Promise<Milestone> {
    const rows = await this.db
      .insert(milestones)
      .values({
        id: input.id,
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        milestoneKey: input.milestoneKey ?? null,
        name: input.name,
        description: input.description,
        notes: input.notes,
        status: input.status ?? 'planned',
        ownerId: input.ownerId,
        // Manual dates persist; a linked Release later derives+overrides them.
        targetStartDate: input.targetStartDate ?? null,
        targetEndDate: input.targetEndDate ?? null,
      })
      .returning();
    return {
      ...rows[0],
      releaseIds: input.releaseIds ?? [],
      projectIds: input.projectIds ?? [],
      teamIds: input.teamIds ?? [],
    };
  }

  async nextKeyNumber(projectId: string, workspaceId: string): Promise<number> {
    // MAX(existing numeric suffix) + 1 (not count+1): milestones can be
    // deleted, so count() would reissue a key a surviving row still holds.
    // POSIX '[0-9]+$' (no backslash) — Drizzle's sql template drops a bare '\'
    // before Postgres sees it, so '\d' would match nothing. Not atomic under
    // concurrent creates, so createMilestone retries on the uq_milestones_key
    // violation this can't fully rule out.
    const rows = await this.db
      .select({
        n: sql<number>`COALESCE(MAX(substring(${milestones.milestoneKey} from '[0-9]+$')::int), 0)::int`,
      })
      .from(milestones)
      .where(and(eq(milestones.projectId, projectId), eq(milestones.workspaceId, workspaceId)));
    return (rows[0]?.n ?? 0) + 1;
  }

  async update(id: string, input: UpdateMilestoneInput): Promise<Milestone> {
    const rows = await this.db
      .update(milestones)
      .set({
        ...(input.name !== undefined && { name: input.name }),
        ...(input.description !== undefined && { description: input.description }),
        ...(input.notes !== undefined && { notes: input.notes }),
        ...(input.status !== undefined && { status: input.status }),
        ...(input.ownerId !== undefined && { ownerId: input.ownerId }),
        ...(input.targetStartDate !== undefined && { targetStartDate: input.targetStartDate }),
        ...(input.targetEndDate !== undefined && { targetEndDate: input.targetEndDate }),
        updatedAt: new Date(),
      })
      .where(eq(milestones.id, id))
      .returning();
    const [releaseIds, projectIds, teamIds] = await Promise.all([
      this.getReleaseIds(id),
      this.getProjectIds(id),
      this.getTeamIds(id),
    ]);
    return { ...rows[0], releaseIds, projectIds, teamIds };
  }

  async delete(id: string): Promise<void> {
    // Clean up all junction table entries
    await Promise.all([
      this.db.delete(milestoneReleases).where(eq(milestoneReleases.milestoneId, id)),
      this.db.delete(milestoneProjects).where(eq(milestoneProjects.milestoneId, id)),
      this.db.delete(milestoneTeams).where(eq(milestoneTeams.milestoneId, id)),
      this.db.delete(milestoneArtifacts).where(eq(milestoneArtifacts.milestoneId, id)),
    ]);
    await this.db.delete(milestones).where(eq(milestones.id, id));
  }

  async setReleaseLinks(milestoneId: string, releaseIds: string[]): Promise<void> {
    await this.db.delete(milestoneReleases).where(eq(milestoneReleases.milestoneId, milestoneId));
    if (releaseIds.length > 0) {
      await this.db
        .insert(milestoneReleases)
        .values(releaseIds.map((releaseId) => ({ milestoneId, releaseId })));
    }
  }

  async getReleaseIds(milestoneId: string): Promise<string[]> {
    const rows = await this.db
      .select({ releaseId: milestoneReleases.releaseId })
      .from(milestoneReleases)
      .where(eq(milestoneReleases.milestoneId, milestoneId));
    return rows.map((r) => r.releaseId);
  }

  // P3.3 — Multi-project support

  async getProjectIds(milestoneId: string): Promise<string[]> {
    const rows = await this.db
      .select({ projectId: milestoneProjects.projectId })
      .from(milestoneProjects)
      .where(eq(milestoneProjects.milestoneId, milestoneId));
    return rows.map((r) => r.projectId);
  }

  async setProjectLinks(milestoneId: string, projectIds: string[]): Promise<void> {
    await this.db.delete(milestoneProjects).where(eq(milestoneProjects.milestoneId, milestoneId));
    if (projectIds.length > 0) {
      await this.db
        .insert(milestoneProjects)
        .values(projectIds.map((projectId) => ({ milestoneId, projectId })));
    }
  }

  // P3.3 — Multi-team support

  async getTeamIds(milestoneId: string): Promise<string[]> {
    const rows = await this.db
      .select({ teamId: milestoneTeams.teamId })
      .from(milestoneTeams)
      .where(eq(milestoneTeams.milestoneId, milestoneId));
    return rows.map((r) => r.teamId);
  }

  async setTeamLinks(milestoneId: string, teamIds: string[]): Promise<void> {
    await this.db.delete(milestoneTeams).where(eq(milestoneTeams.milestoneId, milestoneId));
    if (teamIds.length > 0) {
      await this.db
        .insert(milestoneTeams)
        .values(teamIds.map((teamId) => ({ milestoneId, teamId })));
    }
  }

  // P3.3 — Artifact support

  /**
   * The milestone's DIRECTLY assigned artifact ids — BOTH entity types.
   *
   * It used to filter `entity_type = 'work_item'`, on the grounds that the picker "cannot render or
   * save back" a portfolio item. That is no longer true and was the reason a Feature assigned to a
   * Milestone was invisible from the Milestone end: `Phase 3/03_Milestones/SRS.md:116` makes Story,
   * Defect, Feature and Epic all directly assignable, and §133's payload replaces the whole directly
   * assigned list — so a baseline missing half the link rows would have unticked them on the next
   * save if it had not been filtered on the write side too.
   *
   * No archived predicate: see `MilestonesService.setMilestoneArtifacts` for why this and the write
   * have to agree exactly, or a replace-set silently drops links it never showed the user.
   */
  async getArtifactIds(milestoneId: string): Promise<string[]> {
    const rows = await this.db
      .select({ entityId: milestoneArtifacts.entityId })
      .from(milestoneArtifacts)
      .where(eq(milestoneArtifacts.milestoneId, milestoneId));
    return rows.map((r) => r.entityId);
  }

  /**
   * Replaces the milestone's DIRECT artifact set wholesale, both entity types, in ONE transaction.
   *
   * Transactional because the previous shape was a delete and an insert with nothing around them:
   * a failed insert left the milestone with NO artifacts, which for a replace-set is the worst
   * possible partial state. The `entity_type` predicate that used to sit on the delete is gone on
   * purpose — it scoped the replace to work items, so the §5.2 payload could add a Feature but never
   * remove one.
   */
  async setArtifactLinks(milestoneId: string, artifacts: MilestoneArtifactLink[]): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.delete(milestoneArtifacts).where(eq(milestoneArtifacts.milestoneId, milestoneId));
      if (artifacts.length > 0) {
        await tx.insert(milestoneArtifacts).values(artifacts.map((a) => ({ milestoneId, ...a })));
      }
    });
  }

  async deriveTargetDates(
    releaseIds: string[],
    workspaceId: string,
  ): Promise<{ startDate: string | null; endDate: string | null }> {
    if (releaseIds.length === 0) return { startDate: null, endDate: null };

    const rows = await this.db
      .select({
        startDate: releases.startDate,
        releaseDate: releases.releaseDate,
      })
      .from(releases)
      .where(and(sql`${releases.id} = ANY(${releaseIds})`, eq(releases.workspaceId, workspaceId)));

    if (rows.length === 0) return { startDate: null, endDate: null };

    // Target start = earliest release startDate
    // Target end = latest release releaseDate
    const starts: string[] = [];
    const ends: string[] = [];
    for (const r of rows) {
      if (r.startDate) starts.push(r.startDate);
      if (r.releaseDate) ends.push(r.releaseDate);
    }

    return {
      startDate: starts.length > 0 ? starts.sort()[0] : null,
      endDate: ends.length > 0 ? ends.sort().pop()! : null,
    };
  }
}
