import type { User, SsoIdentity } from '../user.types';
import type { DbExecutor } from '@platform';

export const USER_REPOSITORY = Symbol('USER_REPOSITORY');

export interface IUserRepository {
  findByEmail(email: string): Promise<User | null>;
  findById(id: string): Promise<User | null>;
  /** Create a new password-based user (self-serve signup). */
  create(
    input: {
      email: string;
      displayName: string;
      passwordHash: string;
      emailVerified?: boolean;
    },
    tx?: DbExecutor,
  ): Promise<User>;
  updateLastLogin(id: string, tx?: DbExecutor): Promise<void>;
  updatePasswordHash(id: string, passwordHash: string, tx?: DbExecutor): Promise<void>;
  updateStatus(id: string, status: string, tx?: DbExecutor): Promise<void>;
  updateProfile(
    id: string,
    input: { displayName?: string; avatarUrl?: string | null; locale?: string; timezone?: string },
  ): Promise<User>;
  createPasswordResetToken(
    id: string,
    tokenHash: string,
    expiresAt: Date,
    tx?: DbExecutor,
  ): Promise<void>;
  findPasswordResetToken(
    tokenHash: string,
  ): Promise<{ id: string; userId: string; usedAt: Date | null; expiresAt: Date } | null>;
  markPasswordResetTokenUsed(id: string, tx?: DbExecutor): Promise<void>;

  // ── SSO ───────────────────────────────────────────────────────────────────
  /** Look up an existing SSO identity row by provider + providerSub (Entra oid). */
  findSsoIdentity(provider: string, providerSub: string): Promise<SsoIdentity | null>;
  /**
   * JIT provision: find-or-create a user by email, then create the SSO identity
   * link. Runs in a single transaction so duplicate concurrent logins are safe.
   * If the email matches an existing user (password-based), the SSO identity is
   * linked to that user (account merge).
   */
  upsertBySsoIdentity(
    provider: string,
    providerSub: string,
    providerEmail: string,
    displayName: string,
    tenantId: string,
    tx?: DbExecutor,
  ): Promise<User>;
}
