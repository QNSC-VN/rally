import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ScmInstallationService } from './scm-installation.service';
import type { IScmStore } from '../domain/ports/scm.store';
import type { GithubAppAuthService } from '../infrastructure/github/github-app-auth.service';
import type { JwtPayload } from '@platform';

function jsonResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body, text: async () => '' } as Response;
}

const ACTOR = { sub: 'user-1', workspaceId: 'ws-1' } as unknown as JwtPayload;

describe('ScmInstallationService', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let store: IScmStore;
  let appAuth: GithubAppAuthService;
  let svc: ScmInstallationService;

  beforeEach(() => {
    // GithubRestClient (built inside discover()) hits /installation/repositories.
    fetchMock = vi.fn((url: string) => {
      if (url.includes('/installation/repositories')) {
        return Promise.resolve(
          jsonResponse({ repositories: [{ full_name: 'acme/api' }, { full_name: 'acme/web' }] }),
        );
      }
      throw new Error(`unexpected url ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    store = {
      bindInstallation: vi.fn(async () => {}),
      findWorkspaceByInstallation: vi.fn(async () => ({ workspaceId: 'ws-1' })),
      deactivateInstallation: vi.fn(async () => {}),
      deactivateRepository: vi.fn(async () => {}),
      listInstallations: vi.fn(async () => []),
      upsertDiscoveredRepo: vi.fn(async (r: { fullName: string }) => ({ id: `id-${r.fullName}` })),
      enqueueBackfill: vi.fn(async () => {}),
    } as unknown as IScmStore;

    appAuth = {
      isConfigured: () => true,
      apiBaseUrl: 'https://api.github.com',
      listInstallations: vi.fn(async () => [
        { id: '42', accountLogin: 'acme', accountType: 'Organization' },
      ]),
      getInstallationToken: vi.fn(async () => 'ghs_token'),
    } as unknown as GithubAppAuthService;

    svc = new ScmInstallationService(store, appAuth);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('connect() binds the installation, discovers repos, and backfills each', async () => {
    const res = await svc.connect(ACTOR, '42');

    expect(res).toEqual({ discovered: 2 });
    expect(store.bindInstallation).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'ws-1',
        provider: 'github',
        installationId: '42',
        accountLogin: 'acme',
        accountType: 'Organization',
        createdBy: 'user-1',
      }),
    );
    expect(store.upsertDiscoveredRepo).toHaveBeenCalledTimes(2);
    expect(store.enqueueBackfill).toHaveBeenCalledWith('ws-1', 'id-acme/api');
    expect(store.enqueueBackfill).toHaveBeenCalledWith('ws-1', 'id-acme/web');
  });

  it('connect() throws when the App is not configured', async () => {
    appAuth.isConfigured = () => false;
    await expect(svc.connect(ACTOR, '42')).rejects.toThrow('GitHub App not configured');
    expect(store.bindInstallation).not.toHaveBeenCalled();
  });

  it('listAvailable() flags installations already bound to this workspace', async () => {
    const out = await svc.listAvailable(ACTOR);
    expect(out).toEqual([
      { installationId: '42', accountLogin: 'acme', accountType: 'Organization', connected: true },
    ]);
  });

  it('installation "deleted" webhook deactivates the whole installation', async () => {
    const r = await svc.handleWebhook('installation', {
      action: 'deleted',
      installation: { id: 42, account: { login: 'acme', type: 'Organization' } },
    });
    expect(r).toBe('processed');
    expect(store.deactivateInstallation).toHaveBeenCalledWith('ws-1', 'github', '42');
  });

  it('installation_repositories webhook registers added + deactivates removed', async () => {
    const r = await svc.handleWebhook('installation_repositories', {
      action: 'added',
      installation: { id: 42 },
      repositories_added: [{ full_name: 'acme/new' }],
      repositories_removed: [{ full_name: 'acme/old' }],
    });
    expect(r).toBe('processed');
    expect(store.upsertDiscoveredRepo).toHaveBeenCalledWith(
      expect.objectContaining({ fullName: 'acme/new', installationId: '42' }),
    );
    expect(store.enqueueBackfill).toHaveBeenCalledWith('ws-1', 'id-acme/new');
    expect(store.deactivateRepository).toHaveBeenCalledWith('ws-1', 'github', 'acme/old');
  });

  it('webhooks for an unbound installation are ignored', async () => {
    (store.findWorkspaceByInstallation as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    const r = await svc.handleWebhook('installation', {
      action: 'deleted',
      installation: { id: 999 },
    });
    expect(r).toBe('ignored');
    expect(store.deactivateInstallation).not.toHaveBeenCalled();
  });

  it('connect() skips archived + disabled repos during discovery', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes('/installation/repositories')) {
        return Promise.resolve(
          jsonResponse({
            repositories: [
              { full_name: 'acme/live' },
              { full_name: 'acme/old', archived: true },
              { full_name: 'acme/dead', disabled: true },
            ],
          }),
        );
      }
      throw new Error(`unexpected url ${url}`);
    });
    const res = await svc.connect(ACTOR, '42');
    expect(res).toEqual({ discovered: 1 });
    expect(store.upsertDiscoveredRepo).toHaveBeenCalledTimes(1);
    expect(store.upsertDiscoveredRepo).toHaveBeenCalledWith(
      expect.objectContaining({ fullName: 'acme/live' }),
    );
  });

  it('repository "archived" webhook deactivates the repo', async () => {
    const r = await svc.handleWebhook('repository', {
      action: 'archived',
      installation: { id: 42 },
      repository: { full_name: 'acme/api', archived: true },
    });
    expect(r).toBe('processed');
    expect(store.deactivateRepository).toHaveBeenCalledWith('ws-1', 'github', 'acme/api');
    expect(store.upsertDiscoveredRepo).not.toHaveBeenCalled();
  });

  it('repository "unarchived" webhook re-registers the repo', async () => {
    const r = await svc.handleWebhook('repository', {
      action: 'unarchived',
      installation: { id: 42 },
      repository: { full_name: 'acme/api' },
    });
    expect(r).toBe('processed');
    expect(store.upsertDiscoveredRepo).toHaveBeenCalledWith(
      expect.objectContaining({ fullName: 'acme/api', installationId: '42' }),
    );
    expect(store.enqueueBackfill).toHaveBeenCalledWith('ws-1', 'id-acme/api');
  });
});
