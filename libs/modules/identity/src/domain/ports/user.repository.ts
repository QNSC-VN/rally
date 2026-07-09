import type { User, SsoIdentity } from '../user.types';
import type { DbExecutor } from '@platform';

export const USER_REPOSITORY = Symbol('USER_REPOSITORY');

export interface IUserRepository {
  findByEmail(email: string): Promise<User | null>;
  findById(id: string): Promise<User | null>;
  updateLastLogin(id: string, tx?: DbExecutor): Promise<void>;
  updateStatus(id: string, status: string, tx?: DbExecutor): Promise<void>;
  updateProfile(
    id: string,
    input: { displayName?: string; avatarUrl?: string | null; locale?: string; timezone?: string },
  ): Promise<User>;

  // ── SSO ───────────────────────────────────────────────────────────────────
  /** Look up an existing SSO identity row by provider + providerSub (Entra oid). */
  findSsoIdentity(provider: string, providerSub: string): Promise<SsoIdentity | null>;
  /**
   * JIT provision: find-or-create a user by email, then create the SSO identity
   * link. Runs in a single transaction so duplicate concurrent logins are safe.
   */
  upsertBySsoIdentity(
    provider: string,
    providerSub: string,
    providerEmail: string,
    displayName: string,
    tx?: DbExecutor,
  ): Promise<User>;
}
