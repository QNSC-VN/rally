import type { AuthSession, CreateSessionInput } from '../user.types';
import type { DbExecutor } from '@platform';

export const AUTH_SESSION_REPOSITORY = Symbol('AUTH_SESSION_REPOSITORY');

export interface IAuthSessionRepository {
  findByTokenHash(hash: string): Promise<AuthSession | null>;
  create(input: CreateSessionInput, tx?: DbExecutor): Promise<void>;
  revokeById(id: string, tx?: DbExecutor): Promise<void>;
  revokeFamily(familyId: string, tx?: DbExecutor): Promise<void>;
  revokeAllForUser(userId: string, tx?: DbExecutor): Promise<void>;
}
