import { Inject, Injectable, Logger } from '@nestjs/common';
import type { JwtPayload } from '@platform';
import { SCM_STORE, type IScmStore } from '../domain/ports/scm.store';
import type { ScmProvider } from '../domain/scm.types';
import { GithubAppAuthService } from '../infrastructure/github/github-app-auth.service';
import { GithubRestClient } from '../infrastructure/github/github-rest.client';
import {
  parseInstallationEvent,
  parseInstallationRepositoriesEvent,
} from './github-webhook.parser';

/** Org-level auto-discovery — the App is github.com only. */
const PROVIDER: ScmProvider = 'github';

export interface AvailableInstallation {
  installationId: string;
  accountLogin: string | null;
  accountType: string | null;
  /** True when already bound to the caller's workspace. */
  connected: boolean;
}

/**
 * Binds a GitHub App installation to a workspace and keeps that workspace's
 * repositories in sync automatically. Connecting an installation discovers its
 * repos (REST) and enqueues a backfill each; thereafter `installation` /
 * `installation_repositories` webhooks add/remove repos with no manual step —
 * the org-level model. Linking still happens in the linker via the repo→
 * workspace resolution; this service only manages which repos exist.
 */
@Injectable()
export class ScmInstallationService {
  private readonly logger = new Logger(ScmInstallationService.name);

  constructor(
    @Inject(SCM_STORE) private readonly store: IScmStore,
    private readonly appAuth: GithubAppAuthService,
  ) {}

  /** Installations the App can see, flagged with whether this workspace owns them. */
  async listAvailable(actor: JwtPayload): Promise<AvailableInstallation[]> {
    if (!this.appAuth.isConfigured()) return [];
    const installs = await this.appAuth.listInstallations();
    const out: AvailableInstallation[] = [];
    for (const i of installs) {
      const bound = await this.store.findWorkspaceByInstallation(PROVIDER, i.id);
      out.push({
        installationId: i.id,
        accountLogin: i.accountLogin,
        accountType: i.accountType,
        connected: bound?.workspaceId === actor.workspaceId,
      });
    }
    return out;
  }

  listInstallations(actor: JwtPayload) {
    return this.store.listInstallations(actor.workspaceId);
  }

  /** Bind an installation to the workspace + discover/backfill its repos. */
  async connect(actor: JwtPayload, installationId: string): Promise<{ discovered: number }> {
    if (!this.appAuth.isConfigured()) {
      throw new Error('GitHub App not configured');
    }
    const account = (await this.appAuth.listInstallations()).find((i) => i.id === installationId);
    await this.store.bindInstallation({
      workspaceId: actor.workspaceId,
      provider: PROVIDER,
      installationId,
      accountLogin: account?.accountLogin ?? null,
      accountType: account?.accountType ?? null,
      createdBy: actor.sub,
    });
    const discovered = await this.discover(actor.workspaceId, installationId);
    this.logger.log({ installationId, discovered }, 'Connected installation');
    return { discovered };
  }

  async disconnect(actor: JwtPayload, installationId: string): Promise<void> {
    await this.store.deactivateInstallation(actor.workspaceId, PROVIDER, installationId);
  }

  /** Handle installation / installation_repositories webhooks (worker relay). */
  async handleWebhook(eventType: string, payload: unknown): Promise<'processed' | 'ignored'> {
    if (eventType === 'installation') {
      const ev = parseInstallationEvent(payload);
      if (!ev) return 'ignored';
      const bound = await this.store.findWorkspaceByInstallation(PROVIDER, ev.installationId);
      if (!bound) return 'ignored'; // not connected to any workspace yet
      if (ev.action === 'deleted' || ev.action === 'suspend') {
        await this.store.deactivateInstallation(bound.workspaceId, PROVIDER, ev.installationId);
        return 'processed';
      }
      // created/unsuspend/new_permissions on an already-bound install → (re)discover.
      for (const fullName of ev.repositories) {
        await this.registerRepo(bound.workspaceId, ev.installationId, fullName);
      }
      return 'processed';
    }
    if (eventType === 'installation_repositories') {
      const ev = parseInstallationRepositoriesEvent(payload);
      if (!ev) return 'ignored';
      const bound = await this.store.findWorkspaceByInstallation(PROVIDER, ev.installationId);
      if (!bound) return 'ignored';
      for (const fullName of ev.added) {
        await this.registerRepo(bound.workspaceId, ev.installationId, fullName);
      }
      for (const fullName of ev.removed) {
        await this.store.deactivateRepository(bound.workspaceId, PROVIDER, fullName);
      }
      return 'processed';
    }
    return 'ignored';
  }

  // ── internals ──────────────────────────────────────────────────────────────

  /** List the installation's repos via REST + register/backfill each. Returns count. */
  private async discover(workspaceId: string, installationId: string): Promise<number> {
    const token = await this.appAuth.getInstallationToken(installationId);
    const client = new GithubRestClient(this.appAuth.apiBaseUrl, token);
    const repos = await client.listInstallationRepositories();
    for (const fullName of repos) {
      await this.registerRepo(workspaceId, installationId, fullName);
    }
    return repos.length;
  }

  private async registerRepo(
    workspaceId: string,
    installationId: string,
    fullName: string,
  ): Promise<void> {
    const { id } = await this.store.upsertDiscoveredRepo({
      workspaceId,
      provider: PROVIDER,
      fullName,
      installationId,
    });
    await this.store.enqueueBackfill(workspaceId, id);
  }
}
