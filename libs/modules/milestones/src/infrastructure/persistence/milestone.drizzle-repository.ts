import { Injectable } from '@nestjs/common';
import { and, eq, lt, sql, inArray } from 'drizzle-orm';
import { InjectDrizzle, buildPageResult } from '@platform';
import type { DrizzleDB, CursorPayload, PagedResult } from '@platform';
import {
  milestones,
  milestoneReleases,
  milestoneProjects,
  milestoneTeams,
  milestoneArtifacts,
  releases,
  workItems,
} from '../../../../../../db/schema/work';
import type { Milestone, CreateMilestoneInput, UpdateMilestoneInput } from '../../domain/milestone.types';
import { IMilestoneRepository } from '../../domain/ports/milestone.repository';

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
    tenantId: string,
    { limit, cursor }: { limit: number; cursor: CursorPayload | null },
  ): Promise<PagedResult<Milestone>> {
    const conditions = [eq(milestones.projectId, projectId), eq(milestones.tenantId, tenantId)];
    if (cursor) {
      conditions.push(lt(milestones.createdAt, new Date(cursor.k[0] as string)));
    }

    const rows = await this.db
      .select()
      .from(milestones)
      .where(and(...conditions))
      .orderBy(milestones.createdAt)
      .limit(limit + 1);

    // Batch-fetch release IDs for ALL milestones in a single query (fixes N+1)
    const milestoneIds = rows.map((r) => r.id);
    let releaseMap: Record<string, string[]> = {};
    if (milestoneIds.length > 0) {
      const links = await this.db
        .select({ milestoneId: milestoneReleases.milestoneId, releaseId: milestoneReleases.releaseId })
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

  async create(input: CreateMilestoneInput): Promise<Milestone> {
    const rows = await this.db
      .insert(milestones)
      .values({
        id: input.id,
        tenantId: input.tenantId,
        projectId: input.projectId,
        name: input.name,
        description: input.description,
        notes: input.notes,
        status: input.status ?? 'planned',
        ownerId: input.ownerId,
        targetStartDate: null,
        targetEndDate: null,
      })
      .returning();
    return { ...rows[0], releaseIds: input.releaseIds ?? [], projectIds: input.projectIds ?? [], teamIds: input.teamIds ?? [] };
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
      await this.db.insert(milestoneReleases).values(
        releaseIds.map((releaseId) => ({ milestoneId, releaseId })),
      );
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
      await this.db.insert(milestoneProjects).values(
        projectIds.map((projectId) => ({ milestoneId, projectId })),
      );
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
      await this.db.insert(milestoneTeams).values(
        teamIds.map((teamId) => ({ milestoneId, teamId })),
      );
    }
  }

  // P3.3 — Artifact support

  async getArtifactIds(milestoneId: string): Promise<string[]> {
    const rows = await this.db
      .select({ workItemId: milestoneArtifacts.workItemId })
      .from(milestoneArtifacts)
      .where(eq(milestoneArtifacts.milestoneId, milestoneId));
    return rows.map((r) => r.workItemId);
  }

  async setArtifactLinks(milestoneId: string, workItemIds: string[]): Promise<void> {
    await this.db.delete(milestoneArtifacts).where(eq(milestoneArtifacts.milestoneId, milestoneId));
    if (workItemIds.length > 0) {
      await this.db.insert(milestoneArtifacts).values(
        workItemIds.map((workItemId) => ({ milestoneId, workItemId })),
      );
    }
  }

  async deriveTargetDates(
    releaseIds: string[],
    tenantId: string,
  ): Promise<{ startDate: string | null; endDate: string | null }> {
    if (releaseIds.length === 0) return { startDate: null, endDate: null };

    const rows = await this.db
      .select({
        startDate: releases.startDate,
        releaseDate: releases.releaseDate,
      })
      .from(releases)
      .where(and(sql`${releases.id} = ANY(${releaseIds})`, eq(releases.workspaceId, tenantId)));

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