/**
 * Minimal GitHub REST client for backfill — authenticated with an installation
 * access token. Bounded (page caps) so a huge repo can't run away or exhaust the
 * 5k/hr rate limit. Only the fields the mapper reads are typed.
 */

export interface GhRestPull {
  number: number;
  title: string;
  html_url: string;
  state: string;
  merged_at: string | null;
  created_at: string;
  user: { login: string } | null;
  head: { ref: string } | null;
}

export interface GhRestCommitListItem {
  sha: string;
  html_url: string;
  commit: { message: string; author: { name?: string; email?: string; date?: string } | null };
}

export interface GhRestCommitFile {
  filename: string;
  status: string; // added | modified | removed | renamed | copied | changed
}

export class GithubRestClient {
  constructor(
    private readonly apiBaseUrl: string,
    private readonly token: string,
  ) {}

  /** Recent PRs (all states), newest first. Capped by maxPages × perPage. */
  async listPullRequests(
    fullName: string,
    { perPage = 100, maxPages = 1 }: { perPage?: number; maxPages?: number } = {},
  ): Promise<GhRestPull[]> {
    const [owner, repo] = fullName.split('/');
    const out: GhRestPull[] = [];
    for (let page = 1; page <= maxPages; page++) {
      const batch = await this.get<GhRestPull[]>(
        `/repos/${owner}/${repo}/pulls?state=all&sort=updated&direction=desc&per_page=${perPage}&page=${page}`,
      );
      out.push(...batch);
      if (batch.length < perPage) break;
    }
    return out;
  }

  /** Commits since a date, newest first. Capped by maxPages × perPage. */
  async listCommits(
    fullName: string,
    {
      since,
      perPage = 100,
      maxPages = 3,
    }: { since?: string; perPage?: number; maxPages?: number } = {},
  ): Promise<GhRestCommitListItem[]> {
    const [owner, repo] = fullName.split('/');
    const sinceQ = since ? `&since=${encodeURIComponent(since)}` : '';
    const out: GhRestCommitListItem[] = [];
    for (let page = 1; page <= maxPages; page++) {
      const batch = await this.get<GhRestCommitListItem[]>(
        `/repos/${owner}/${repo}/commits?per_page=${perPage}&page=${page}${sinceQ}`,
      );
      out.push(...batch);
      if (batch.length < perPage) break;
    }
    return out;
  }

  /** File list for one commit (only fetched for commits that reference a key). */
  async getCommitFiles(fullName: string, sha: string): Promise<GhRestCommitFile[]> {
    const [owner, repo] = fullName.split('/');
    const body = await this.get<{ files?: GhRestCommitFile[] }>(
      `/repos/${owner}/${repo}/commits/${sha}`,
    );
    return body.files ?? [];
  }

  private async get<T>(path: string): Promise<T> {
    const res = await fetch(`${this.apiBaseUrl}${path}`, {
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`GitHub REST GET ${path} failed (${res.status}): ${text.slice(0, 200)}`);
    }
    return (await res.json()) as T;
  }
}
