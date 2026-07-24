import { describe, it, expect } from 'vitest';
import { extractWorkItemKeys } from './scm-key-parser';
import { parsePullRequestEvent, parsePushEvent } from './github-webhook.parser';

describe('extractWorkItemKeys', () => {
  it('finds keys across title, branch and message; de-dups and upper-cases', () => {
    expect(extractWorkItemKeys('fix(US-1): thing', 'us-1-branch', 'also DE-42')).toEqual([
      'US-1',
      'DE-42',
    ]);
  });

  it('matches every type prefix and ignores non-keys', () => {
    expect(extractWorkItemKeys('IN-1 FE-2 US-3 TA-4 DE-5 XX-6 US- 7')).toEqual([
      'IN-1',
      'FE-2',
      'US-3',
      'TA-4',
      'DE-5',
    ]);
  });

  it('returns [] when nothing matches or inputs are empty', () => {
    expect(extractWorkItemKeys('no keys here', null, undefined)).toEqual([]);
  });
});

describe('parsePullRequestEvent', () => {
  const base = {
    action: 'opened',
    pull_request: {
      number: 42,
      title: 'fix(US-1): patch',
      html_url: 'https://ghe/acme/demo/pull/42',
      state: 'open',
      merged: false,
      created_at: '2026-07-24T10:00:00Z',
      user: { login: 'octocat' },
      head: { ref: 'US-1-branch' },
    },
    repository: { full_name: 'acme/demo' },
  };

  it('normalizes a PR and extracts its keys + externalId', () => {
    const pr = parsePullRequestEvent(base);
    expect(pr).toMatchObject({
      kind: 'pull_request',
      repositoryFullName: 'acme/demo',
      externalId: 'acme/demo#42',
      state: 'open',
      authorName: 'octocat',
      keys: ['US-1'],
    });
  });

  it('reports merged state', () => {
    const pr = parsePullRequestEvent({
      ...base,
      pull_request: { ...base.pull_request, merged: true, state: 'closed' },
    });
    expect(pr?.state).toBe('merged');
  });

  it('ignores unhandled actions and PRs with no key', () => {
    expect(parsePullRequestEvent({ ...base, action: 'labeled' })).toBeNull();
    expect(
      parsePullRequestEvent({
        ...base,
        pull_request: { ...base.pull_request, title: 'no key', head: { ref: 'x' } },
      }),
    ).toBeNull();
  });
});

describe('parsePushEvent', () => {
  it('normalizes commits, maps A/M/D changes, and skips key-less commits', () => {
    const commits = parsePushEvent({
      ref: 'refs/heads/US-1-branch',
      repository: { full_name: 'acme/demo' },
      commits: [
        {
          id: '5fda056ac289def3f2',
          message: 'fix(US-1): patch the thing',
          timestamp: '2026-07-24T10:05:00Z',
          url: 'https://ghe/acme/demo/commit/5fda056a',
          author: { name: 'Bao Gia Ha', email: 'bao@acme.dev' },
          added: ['src/new.ts'],
          modified: ['src/a.ts'],
          removed: ['src/old.ts'],
        },
        { id: 'deadbeef', message: 'chore: no key', added: [], modified: [], removed: [] },
      ],
    });
    expect(commits).toHaveLength(1);
    expect(commits[0]).toMatchObject({
      kind: 'commit',
      revision: '5fda056ac289def3f2',
      shortName: 'demo:5fda056a',
      authorName: 'Bao Gia Ha',
      keys: ['US-1'],
    });
    expect(commits[0].changes).toEqual([
      { action: 'A', path: 'src/new.ts' },
      { action: 'M', path: 'src/a.ts' },
      { action: 'D', path: 'src/old.ts' },
    ]);
  });

  it('returns [] when repository or commits are missing', () => {
    expect(parsePushEvent({ commits: [] })).toEqual([]);
    expect(parsePushEvent({ repository: { full_name: 'acme/demo' } })).toEqual([]);
  });
});
