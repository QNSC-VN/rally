import type { SsoConnection } from '../user.types';

export const SSO_CONNECTION_REPOSITORY = Symbol('SSO_CONNECTION_REPOSITORY');

export interface ISsoConnectionRepository {
  /**
   * Look up an active SSO connection by provider + external IdP tenant id
   * (Entra `tid`). Runs across all workspaces — this is how a federated user is
   * routed to the correct workspace before any workspace context is known.
   */
  findByExternalTenantId(provider: string, externalTenantId: string): Promise<SsoConnection | null>;
}
