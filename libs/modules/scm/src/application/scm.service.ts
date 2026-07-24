import { Inject, Injectable } from '@nestjs/common';
import type { JwtPayload, PagedResult } from '@platform';
import { SCM_STORE, type IScmStore, type PageArgs } from '../domain/ports/scm.store';
import type { ScmProvider, ScmRepository, ScmConnection, ScmChangeset } from '../domain/scm.types';

/** Read-side + repo-mapping use cases for the API. Ingestion/linking is the relay's job. */
@Injectable()
export class ScmService {
  constructor(@Inject(SCM_STORE) private readonly store: IScmStore) {}

  // ── Work-item connection/changeset reads (workspace-scoped) ──────────────────

  listConnections(
    actor: JwtPayload,
    workItemId: string,
    args: PageArgs,
  ): Promise<PagedResult<ScmConnection>> {
    return this.store.listConnections(workItemId, actor.workspaceId, args);
  }

  listChangesets(
    actor: JwtPayload,
    workItemId: string,
    args: PageArgs,
  ): Promise<PagedResult<ScmChangeset>> {
    return this.store.listChangesets(workItemId, actor.workspaceId, args);
  }

  counts(
    actor: JwtPayload,
    workItemId: string,
  ): Promise<{ connections: number; changesets: number }> {
    return this.store.countByWorkItem(workItemId, actor.workspaceId);
  }

  // ── Repository ↔ project mapping (workspace-scoped) ──────────────────────────

  listRepositories(actor: JwtPayload): Promise<ScmRepository[]> {
    return this.store.listRepositories(actor.workspaceId);
  }

  async createRepository(
    actor: JwtPayload,
    input: {
      provider: ScmProvider;
      fullName: string;
      baseUrl?: string | null;
      projectIds: string[];
    },
  ): Promise<ScmRepository> {
    const repo = await this.store.createRepository({ workspaceId: actor.workspaceId, ...input });
    // Auto-backfill existing PRs/commits on map (drained by the worker relay).
    await this.store.enqueueBackfill(actor.workspaceId, repo.id);
    return repo;
  }

  deleteRepository(actor: JwtPayload, id: string): Promise<void> {
    return this.store.deleteRepository(actor.workspaceId, id);
  }

  /** Manual "Sync now": enqueue a backfill job for an already-mapped repo. */
  async syncRepository(actor: JwtPayload, id: string): Promise<{ enqueued: boolean }> {
    const repo = await this.store.getRepositoryForBackfill(id);
    if (!repo || repo.workspaceId !== actor.workspaceId) return { enqueued: false };
    await this.store.enqueueBackfill(actor.workspaceId, id);
    return { enqueued: true };
  }

  // ── Webhook ingestion (called by the @Public webhook controller) ─────────────

  /** Persist a verified raw event; returns false when the delivery id was seen before. */
  ingestWebhook(
    provider: ScmProvider,
    deliveryId: string,
    eventType: string,
    payload: unknown,
  ): Promise<{ inserted: boolean }> {
    return this.store.insertInboxEvent({ provider, deliveryId, eventType, payload });
  }
}
