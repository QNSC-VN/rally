import type { AuthSession, CreateSessionInput } from '../user.types';
import type { DbExecutor } from '@platform';

export const AUTH_SESSION_REPOSITORY = Symbol('AUTH_SESSION_REPOSITORY');

export interface IAuthSessionRepository {
  findByTokenHash(hash: string): Promise<AuthSession | null>;
  create(input: CreateSessionInput, tx?: DbExecutor): Promise<void>;
  revokeById(id: string, tx?: DbExecutor): Promise<void>;
  /**
   * Atomically revoke a session only if it is still active. Returns `true` if
   * this call flipped `is_revoked` false→true, `false` if it was already
   * revoked (i.e. a concurrent request won the rotation race). Enables
   * single-use refresh-token rotation without creating two live sessions.
   */
  revokeByIdIfActive(id: string, tx?: DbExecutor): Promise<boolean>;
  revokeFamily(familyId: string, tx?: DbExecutor): Promise<void>;
  revokeAllForUser(userId: string, tx?: DbExecutor): Promise<void>;
}
