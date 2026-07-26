import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { InjectDrizzle, NotFoundException } from '@platform';
import type { JwtPayload, PagedResult, DrizzleDB } from '@platform';
import { AccessService } from '@modules/access';
import { PERMISSION } from '@shared-kernel';
import { workItems } from '../../../../../db/schema/work';
import { SCM_STORE, type IScmStore, type PageArgs } from '../domain/ports/scm.store';
import type {
  ScmProvider,
  ScmRepository,
  ScmRepositoryWithSync,
  ScmConnection,
  ScmChangeset,
} from '../domain/scm.types';

/** Read-side + repo-mapping use cases for the API. Ingestion/linking is the relay's job. */
@Injectable()
export class ScmService {
  constructor(
    @Inject(SCM_STORE) private readonly store: IScmStore,
    @InjectDrizzle() private readonly db: DrizzleDB,
    private readonly accessService: AccessService,
  ) {}

  /**
   * SCM links belong to a work item, so viewing them requires `work_item:view`
   * at that work item's PROJECT scope — not just workspace membership. Resolves
   * the work item's project and enforces before any connection/changeset read.
   */
  private async assertCanViewWorkItem(actor: JwtPayload, workItemId: string): Promise<void> {
    const rows = await this.db
      .select({ projectId: workItems.projectId })
      .from(workItems)
      .where(and(eq(workItems.id, workItemId), eq(workItems.workspaceId, actor.workspaceId)))
      .limit(1);
    const projectId = rows[0]?.projectId;
    if (!projectId) throw new NotFoundException('WORK_ITEM_NOT_FOUND', 'Work item not found');
    await this.accessService.assertProjectPermission(actor, projectId, PERMISSION.WORK_ITEM_VIEW);
  }

  // ── Work-item connection/changeset reads (project-scoped: work_item:view) ────

  async listConnections(
    actor: JwtPayload,
    workItemId: string,
    args: PageArgs,
  ): Promise<PagedResult<ScmConnection>> {
    await this.assertCanViewWorkItem(actor, workItemId);
    return this.store.listConnections(workItemId, actor.workspaceId, args);
  }

  async listChangesets(
    actor: JwtPayload,
    workItemId: string,
    args: PageArgs,
  ): Promise<PagedResult<ScmChangeset>> {
    await this.assertCanViewWorkItem(actor, workItemId);
    return this.store.listChangesets(workItemId, actor.workspaceId, args);
  }

  async counts(
    actor: JwtPayload,
    workItemId: string,
  ): Promise<{ connections: number; changesets: number }> {
    await this.assertCanViewWorkItem(actor, workItemId);
    return this.store.countByWorkItem(workItemId, actor.workspaceId);
  }

  // ── Repository ↔ project mapping (workspace-scoped) ──────────────────────────

  listRepositories(actor: JwtPayload): Promise<ScmRepositoryWithSync[]> {
    return this.store.listRepositoriesWithSync(actor.workspaceId);
  }

  async createRepository(
    actor: JwtPayload,
    input: {
      provider: ScmProvider;
      fullName: string;
      baseUrl?: string | null;
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
