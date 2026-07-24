import { Injectable } from '@nestjs/common';
import { and, eq, lt, isNull, inArray, desc } from 'drizzle-orm';
import { InjectDrizzle, buildPageResult } from '@platform';
import type { DrizzleDB, PagedResult } from '@platform';
import {
  scmRepositories,
  scmRepositoryProjects,
  scmWebhookInbox,
  scmConnections,
  scmChangesets,
  scmBackfillJobs,
} from '../../../../../../db/schema/scm';
import { workItems } from '../../../../../../db/schema/work';
import type {
  ScmProvider,
  ScmRepository,
  CreateScmRepositoryInput,
  ScmConnection,
  ScmChangeset,
  UpsertConnectionInput,
  UpsertChangesetInput,
} from '../../domain/scm.types';
import type { IScmStore, PageArgs } from '../../domain/ports/scm.store';

@Injectable()
export class ScmDrizzleRepository implements IScmStore {
  constructor(@InjectDrizzle() private readonly db: DrizzleDB) {}

  // ── Repositories + mapping ────────────────────────────────────────────────

  async listRepositories(workspaceId: string): Promise<ScmRepository[]> {
    const repos = await this.db
      .select()
      .from(scmRepositories)
      .where(eq(scmRepositories.workspaceId, workspaceId))
      .orderBy(scmRepositories.fullName);
    if (repos.length === 0) return [];
    const links = await this.db
      .select()
      .from(scmRepositoryProjects)
      .where(
        inArray(
          scmRepositoryProjects.repositoryId,
          repos.map((r) => r.id),
        ),
      );
    const byRepo = new Map<string, string[]>();
    for (const l of links) {
      const arr = byRepo.get(l.repositoryId) ?? [];
      arr.push(l.projectId);
      byRepo.set(l.repositoryId, arr);
    }
    return repos.map((r) => this.toRepository(r, byRepo.get(r.id) ?? []));
  }

  async createRepository(input: CreateScmRepositoryInput): Promise<ScmRepository> {
    const [repo] = await this.db
      .insert(scmRepositories)
      .values({
        workspaceId: input.workspaceId,
        provider: input.provider,
        fullName: input.fullName,
        baseUrl: input.baseUrl ?? null,
      })
      .onConflictDoUpdate({
        target: [scmRepositories.workspaceId, scmRepositories.provider, scmRepositories.fullName],
        set: { baseUrl: input.baseUrl ?? null, active: true, updatedAt: new Date() },
      })
      .returning();
    // Replace project links.
    await this.db
      .delete(scmRepositoryProjects)
      .where(eq(scmRepositoryProjects.repositoryId, repo.id));
    if (input.projectIds.length > 0) {
      await this.db
        .insert(scmRepositoryProjects)
        .values(input.projectIds.map((projectId) => ({ repositoryId: repo.id, projectId })))
        .onConflictDoNothing();
    }
    return this.toRepository(repo, input.projectIds);
  }

  async deleteRepository(workspaceId: string, id: string): Promise<void> {
    await this.db
      .delete(scmRepositories)
      .where(and(eq(scmRepositories.id, id), eq(scmRepositories.workspaceId, workspaceId)));
    await this.db.delete(scmRepositoryProjects).where(eq(scmRepositoryProjects.repositoryId, id));
  }

  async findRepository(
    provider: ScmProvider,
    fullName: string,
  ): Promise<{ workspaceId: string; projectIds: string[] } | null> {
    const [repo] = await this.db
      .select()
      .from(scmRepositories)
      .where(
        and(
          eq(scmRepositories.provider, provider),
          eq(scmRepositories.fullName, fullName),
          eq(scmRepositories.active, true),
        ),
      )
      .limit(1);
    if (!repo) return null;
    const links = await this.db
      .select({ projectId: scmRepositoryProjects.projectId })
      .from(scmRepositoryProjects)
      .where(eq(scmRepositoryProjects.repositoryId, repo.id));
    return { workspaceId: repo.workspaceId, projectIds: links.map((l) => l.projectId) };
  }

  // ── Backfill ───────────────────────────────────────────────────────────────

  async getRepositoryForBackfill(id: string): Promise<{
    id: string;
    workspaceId: string;
    provider: ScmProvider;
    fullName: string;
    installationId: string | null;
  } | null> {
    const [repo] = await this.db
      .select()
      .from(scmRepositories)
      .where(eq(scmRepositories.id, id))
      .limit(1);
    if (!repo) return null;
    return {
      id: repo.id,
      workspaceId: repo.workspaceId,
      provider: repo.provider,
      fullName: repo.fullName,
      installationId: repo.installationId,
    };
  }

  async setInstallationId(id: string, installationId: string): Promise<void> {
    await this.db
      .update(scmRepositories)
      .set({ installationId, updatedAt: new Date() })
      .where(eq(scmRepositories.id, id));
  }

  async enqueueBackfill(workspaceId: string, repositoryId: string): Promise<void> {
    await this.db.insert(scmBackfillJobs).values({ workspaceId, repositoryId });
  }

  // ── Work-item resolution ──────────────────────────────────────────────────

  async resolveWorkItemId(
    itemKey: string,
    projectId: string,
    workspaceId: string,
  ): Promise<string | null> {
    const [row] = await this.db
      .select({ id: workItems.id })
      .from(workItems)
      .where(
        and(
          eq(workItems.itemKey, itemKey),
          eq(workItems.projectId, projectId),
          eq(workItems.workspaceId, workspaceId),
          isNull(workItems.deletedAt),
        ),
      )
      .limit(1);
    return row?.id ?? null;
  }

  // ── Webhook inbox ───────────────────────────────────────────────────────────

  async insertInboxEvent(row: {
    provider: ScmProvider;
    deliveryId: string;
    eventType: string;
    payload: unknown;
  }): Promise<{ inserted: boolean }> {
    const inserted = await this.db
      .insert(scmWebhookInbox)
      .values({
        provider: row.provider,
        deliveryId: row.deliveryId,
        eventType: row.eventType,
        payload: row.payload,
      })
      .onConflictDoNothing({ target: [scmWebhookInbox.provider, scmWebhookInbox.deliveryId] })
      .returning({ id: scmWebhookInbox.id });
    return { inserted: inserted.length > 0 };
  }

  // ── Links (idempotent upserts) ───────────────────────────────────────────────

  async upsertConnection(input: UpsertConnectionInput): Promise<void> {
    await this.db
      .insert(scmConnections)
      .values(input)
      .onConflictDoUpdate({
        target: [scmConnections.workItemId, scmConnections.externalId],
        // PR edits/merges update the mutable fields; identity stays.
        set: {
          name: input.name,
          url: input.url,
          state: input.state,
          authorName: input.authorName,
          updatedAt: new Date(),
        },
      });
  }

  async upsertChangeset(input: UpsertChangesetInput): Promise<void> {
    await this.db
      .insert(scmChangesets)
      .values(input)
      // Commits are immutable — first write wins, redelivery is a no-op.
      .onConflictDoNothing({
        target: [scmChangesets.workItemId, scmChangesets.revision],
      });
  }

  async listConnections(
    workItemId: string,
    workspaceId: string,
    args: PageArgs,
  ): Promise<PagedResult<ScmConnection>> {
    const conditions = [
      eq(scmConnections.workItemId, workItemId),
      eq(scmConnections.workspaceId, workspaceId),
    ];
    if (args.cursor)
      conditions.push(lt(scmConnections.createdAt, new Date(args.cursor.k[0] as string)));
    const rows = await this.db
      .select()
      .from(scmConnections)
      .where(and(...conditions))
      .orderBy(desc(scmConnections.createdAt))
      .limit(args.limit + 1);
    return buildPageResult(
      rows.map(this.toConnection),
      args.limit,
      (c) => [c.createdAt.toISOString()],
      'desc',
    );
  }

  async listChangesets(
    workItemId: string,
    workspaceId: string,
    args: PageArgs,
  ): Promise<PagedResult<ScmChangeset>> {
    const conditions = [
      eq(scmChangesets.workItemId, workItemId),
      eq(scmChangesets.workspaceId, workspaceId),
    ];
    if (args.cursor)
      conditions.push(lt(scmChangesets.createdAt, new Date(args.cursor.k[0] as string)));
    const rows = await this.db
      .select()
      .from(scmChangesets)
      .where(and(...conditions))
      .orderBy(desc(scmChangesets.createdAt))
      .limit(args.limit + 1);
    return buildPageResult(
      rows.map(this.toChangeset),
      args.limit,
      (c) => [c.createdAt.toISOString()],
      'desc',
    );
  }

  async countByWorkItem(
    workItemId: string,
    workspaceId: string,
  ): Promise<{ connections: number; changesets: number }> {
    const [conns, changes] = await Promise.all([
      this.db
        .select({ id: scmConnections.id })
        .from(scmConnections)
        .where(
          and(
            eq(scmConnections.workItemId, workItemId),
            eq(scmConnections.workspaceId, workspaceId),
          ),
        ),
      this.db
        .select({ id: scmChangesets.id })
        .from(scmChangesets)
        .where(
          and(eq(scmChangesets.workItemId, workItemId), eq(scmChangesets.workspaceId, workspaceId)),
        ),
    ]);
    return { connections: conns.length, changesets: changes.length };
  }

  // ── Row mappers ─────────────────────────────────────────────────────────────

  private toRepository(
    r: typeof scmRepositories.$inferSelect,
    projectIds: string[],
  ): ScmRepository {
    return {
      id: r.id,
      workspaceId: r.workspaceId,
      provider: r.provider,
      fullName: r.fullName,
      baseUrl: r.baseUrl,
      active: r.active,
      projectIds,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  }

  private toConnection = (r: typeof scmConnections.$inferSelect): ScmConnection => ({
    id: r.id,
    workspaceId: r.workspaceId,
    workItemId: r.workItemId,
    provider: r.provider,
    type: r.type,
    externalId: r.externalId,
    name: r.name,
    url: r.url,
    state: r.state,
    authorName: r.authorName,
    sourceCreatedAt: r.sourceCreatedAt,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  });

  private toChangeset = (r: typeof scmChangesets.$inferSelect): ScmChangeset => ({
    id: r.id,
    workspaceId: r.workspaceId,
    workItemId: r.workItemId,
    provider: r.provider,
    revision: r.revision,
    name: r.name,
    message: r.message,
    uri: r.uri,
    authorName: r.authorName,
    authorEmail: r.authorEmail,
    committedAt: r.committedAt,
    changes: r.changes ?? [],
    repositoryFullName: r.repositoryFullName,
    createdAt: r.createdAt,
  });
}
