/**
 * SCM domain types — Connections (Pull Requests), Changesets (commits), the
 * repo→project mapping, and normalized webhook events.
 */

export type ScmProvider = 'github' | 'ghe';
export type ScmConnectionType = 'pull_request' | 'build' | 'branch';
export type ScmChangeAction = 'A' | 'M' | 'D';
export type ScmInboxStatus = 'pending' | 'processed' | 'ignored' | 'failed';

export interface ScmChange {
  action: ScmChangeAction;
  path: string;
}

/** A registered repository and the projects whose keys it may reference. */
export interface ScmRepository {
  id: string;
  workspaceId: string;
  provider: ScmProvider;
  fullName: string;
  baseUrl: string | null;
  active: boolean;
  projectIds: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateScmRepositoryInput {
  workspaceId: string;
  provider: ScmProvider;
  fullName: string;
  baseUrl?: string | null;
  projectIds: string[];
}

/** A Pull Request (or future build/branch) linked to a work item. */
export interface ScmConnection {
  id: string;
  workspaceId: string;
  workItemId: string;
  provider: ScmProvider;
  type: ScmConnectionType;
  externalId: string;
  name: string;
  url: string;
  state: string | null;
  authorName: string | null;
  sourceCreatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** A commit linked to a work item. */
export interface ScmChangeset {
  id: string;
  workspaceId: string;
  workItemId: string;
  provider: ScmProvider;
  revision: string;
  name: string;
  message: string | null;
  uri: string | null;
  authorName: string | null;
  authorEmail: string | null;
  committedAt: Date | null;
  changes: ScmChange[];
  repositoryFullName: string | null;
  createdAt: Date;
}

/** Upsert payloads (identity fields resolve the dedup key). */
export type UpsertConnectionInput = Omit<ScmConnection, 'id' | 'createdAt' | 'updatedAt'>;
export type UpsertChangesetInput = Omit<ScmChangeset, 'id' | 'createdAt'>;

/** A raw webhook event persisted for async processing. */
export interface WebhookInboxRow {
  id: string;
  provider: ScmProvider;
  deliveryId: string;
  eventType: string;
  payload: unknown;
  status: ScmInboxStatus;
  attempts: number;
}

// ── Normalized webhook events (provider-agnostic; the parser produces these) ──

/** A PR extracted from a `pull_request` event, plus the keys it references. */
export interface NormalizedPullRequest {
  kind: 'pull_request';
  repositoryFullName: string;
  externalId: string; // e.g. "owner/name#123"
  number: number;
  title: string;
  url: string;
  state: string; // open | closed | merged
  authorName: string | null;
  createdAt: string | null;
  /** work-item keys found in title + branch. */
  keys: string[];
}

/** A commit extracted from a `push` event, plus the keys it references. */
export interface NormalizedCommit {
  kind: 'commit';
  repositoryFullName: string;
  revision: string; // full SHA
  shortName: string; // "<repoShort>:<shortSha>"
  message: string;
  uri: string;
  authorName: string | null;
  authorEmail: string | null;
  committedAt: string | null;
  changes: ScmChange[];
  keys: string[];
}

export type NormalizedScmArtifact = NormalizedPullRequest | NormalizedCommit;
