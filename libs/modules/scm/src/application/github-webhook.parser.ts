/**
 * GitHub / GitHub-Enterprise webhook payload → provider-agnostic normalized
 * artifacts. Pure functions (no I/O) so they're trivially unit-testable.
 *
 * We only consume `pull_request` and `push`. Payload shapes are typed minimally
 * (just the fields we read) rather than importing GitHub's full types.
 */
import { extractWorkItemKeys } from './scm-key-parser';
import type { NormalizedPullRequest, NormalizedCommit, ScmChange } from '../domain/scm.types';

interface GhPullRequestPayload {
  action?: string;
  pull_request?: {
    number?: number;
    title?: string;
    html_url?: string;
    state?: string;
    merged?: boolean;
    created_at?: string;
    user?: { login?: string };
    head?: { ref?: string };
  };
  repository?: { full_name?: string };
}

interface GhPushCommit {
  id?: string;
  message?: string;
  timestamp?: string;
  url?: string;
  author?: { name?: string; email?: string; username?: string };
  added?: string[];
  modified?: string[];
  removed?: string[];
}
interface GhPushPayload {
  ref?: string;
  repository?: { full_name?: string };
  commits?: GhPushCommit[];
}

/** PR actions worth ingesting (open/update/close lifecycle). */
const PR_ACTIONS = new Set([
  'opened',
  'edited',
  'synchronize',
  'reopened',
  'closed',
  'ready_for_review',
]);

/** Short repo label for a changeset name, e.g. "DT-SFI/dt" → "dt". */
function repoShort(fullName: string): string {
  const parts = fullName.split('/');
  return parts[parts.length - 1] || fullName;
}

export function parsePullRequestEvent(payload: unknown): NormalizedPullRequest | null {
  const p = payload as GhPullRequestPayload;
  if (p.action && !PR_ACTIONS.has(p.action)) return null;
  const pr = p.pull_request;
  const fullName = p.repository?.full_name;
  if (!pr || !fullName || typeof pr.number !== 'number' || !pr.title || !pr.html_url) return null;

  const keys = extractWorkItemKeys(pr.title, pr.head?.ref);
  if (keys.length === 0) return null; // nothing to link

  const state = pr.merged ? 'merged' : (pr.state ?? 'open');
  return {
    kind: 'pull_request',
    repositoryFullName: fullName,
    externalId: `${fullName}#${pr.number}`,
    number: pr.number,
    title: pr.title,
    url: pr.html_url,
    state,
    authorName: pr.user?.login ?? null,
    createdAt: pr.created_at ?? null,
    keys,
  };
}

export function parsePushEvent(payload: unknown): NormalizedCommit[] {
  const p = payload as GhPushPayload;
  const fullName = p.repository?.full_name;
  const commits = p.commits;
  if (!fullName || !Array.isArray(commits)) return [];

  const out: NormalizedCommit[] = [];
  for (const c of commits) {
    if (!c.id || !c.message) continue;
    const keys = extractWorkItemKeys(c.message);
    if (keys.length === 0) continue;

    const changes: ScmChange[] = [
      ...(c.added ?? []).map((path) => ({ action: 'A' as const, path })),
      ...(c.modified ?? []).map((path) => ({ action: 'M' as const, path })),
      ...(c.removed ?? []).map((path) => ({ action: 'D' as const, path })),
    ];
    out.push({
      kind: 'commit',
      repositoryFullName: fullName,
      revision: c.id,
      shortName: `${repoShort(fullName)}:${c.id.slice(0, 8)}`,
      message: c.message,
      uri: c.url ?? '',
      authorName: c.author?.name ?? c.author?.username ?? null,
      authorEmail: c.author?.email ?? null,
      committedAt: c.timestamp ?? null,
      changes,
      keys,
    });
  }
  return out;
}
