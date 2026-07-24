import type { CursorPayload, PagedResult } from '@platform';
import type {
  ScmProvider,
  ScmRepository,
  CreateScmRepositoryInput,
  ScmConnection,
  ScmChangeset,
  UpsertConnectionInput,
  UpsertChangesetInput,
} from '../scm.types';

export const SCM_STORE = Symbol('SCM_STORE');

export interface PageArgs {
  limit: number;
  cursor: CursorPayload | null;
}

/**
 * Persistence port for the whole SCM module. One store keeps the aggregate
 * small and the linker/relay/service consistent; the Drizzle implementation
 * lives in infrastructure/persistence.
 */
export interface IScmStore {
  // ── Repositories + mapping ────────────────────────────────────────────────
  listRepositories(workspaceId: string): Promise<ScmRepository[]>;
  createRepository(input: CreateScmRepositoryInput): Promise<ScmRepository>;
  deleteRepository(workspaceId: string, id: string): Promise<void>;
  /** Resolve a repo (with its mapped project ids) for linking. Null if unmapped/inactive. */
  findRepository(
    provider: ScmProvider,
    fullName: string,
  ): Promise<{ workspaceId: string; projectIds: string[] } | null>;

  // ── Backfill (GitHub App REST) ────────────────────────────────────────────
  /** Load the minimal repo identity a backfill run needs. Null if not found. */
  getRepositoryForBackfill(id: string): Promise<{
    id: string;
    workspaceId: string;
    provider: ScmProvider;
    fullName: string;
    installationId: string | null;
  } | null>;
  /** Cache the resolved App installation id on the repo. */
  setInstallationId(id: string, installationId: string): Promise<void>;
  /** Enqueue a pending backfill job for a repo (drained by the worker relay). */
  enqueueBackfill(workspaceId: string, repositoryId: string): Promise<void>;

  // ── Work-item resolution (key → id), no actor (webhook has no user) ─────────
  resolveWorkItemId(
    itemKey: string,
    projectId: string,
    workspaceId: string,
  ): Promise<string | null>;

  // ── Webhook inbox ───────────────────────────────────────────────────────────
  /** Insert a raw event; returns false if the delivery id already exists (dedup). */
  insertInboxEvent(row: {
    provider: ScmProvider;
    deliveryId: string;
    eventType: string;
    payload: unknown;
  }): Promise<{ inserted: boolean }>;

  // ── Links (connections + changesets) — idempotent upserts ────────────────────
  upsertConnection(input: UpsertConnectionInput): Promise<void>;
  upsertChangeset(input: UpsertChangesetInput): Promise<void>;
  listConnections(
    workItemId: string,
    workspaceId: string,
    args: PageArgs,
  ): Promise<PagedResult<ScmConnection>>;
  listChangesets(
    workItemId: string,
    workspaceId: string,
    args: PageArgs,
  ): Promise<PagedResult<ScmChangeset>>;
  countByWorkItem(
    workItemId: string,
    workspaceId: string,
  ): Promise<{ connections: number; changesets: number }>;
}
// The worker relay drains scm.webhook_inbox directly against its own tx
// (FOR UPDATE SKIP LOCKED), mirroring notification-relay — no store port needed.
