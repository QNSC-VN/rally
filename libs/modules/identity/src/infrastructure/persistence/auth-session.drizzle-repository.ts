import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { InjectDrizzle } from '@platform';
import type { DrizzleDB, DbExecutor } from '@platform';
import { authSessions } from '../../../../../../db/schema/identity';
import { ssoProviderEnum } from '../../../../../../db/schema/enums';
import type { AuthSession, CreateSessionInput } from '../../domain/user.types';

type SsoProvider = (typeof ssoProviderEnum.enumValues)[number];
import { IAuthSessionRepository } from '../../domain/ports/auth-session.repository';

@Injectable()
export class AuthSessionDrizzleRepository implements IAuthSessionRepository {
  constructor(@InjectDrizzle() private readonly db: DrizzleDB) {}

  async findByTokenHash(hash: string): Promise<AuthSession | null> {
    const rows = await this.db
      .select()
      .from(authSessions)
      .where(eq(authSessions.tokenHash, hash))
      .limit(1);
    if (!rows[0]) return null;
    const row = rows[0];
    return {
      id: row.id,
      workspaceId: row.workspaceId,
      userId: row.userId,
      tokenHash: row.tokenHash,
      familyId: row.familyId,
      isRevoked: row.isRevoked,
      expiresAt: row.expiresAt,
      createdAt: row.createdAt,
      ssoProvider: row.ssoProvider ?? null,
      csrfToken: row.csrfToken ?? null,
    };
  }

  async create(input: CreateSessionInput, tx?: DbExecutor): Promise<void> {
    await (tx ?? this.db).insert(authSessions).values({
      id: input.id,
      workspaceId: input.workspaceId,
      userId: input.userId,
      tokenHash: input.tokenHash,
      familyId: input.familyId,
      ipAddress: input.ipAddress,
      expiresAt: input.expiresAt,
      ssoProvider: (input.ssoProvider as SsoProvider | undefined) ?? null,
      csrfToken: input.csrfToken ?? null,
    });
  }

  async revokeById(id: string, tx?: DbExecutor): Promise<void> {
    await (tx ?? this.db)
      .update(authSessions)
      .set({ isRevoked: true })
      .where(eq(authSessions.id, id));
  }

  async revokeFamily(familyId: string, tx?: DbExecutor): Promise<void> {
    await (tx ?? this.db)
      .update(authSessions)
      .set({ isRevoked: true })
      .where(eq(authSessions.familyId, familyId));
  }

  async revokeAllForUser(userId: string, tx?: DbExecutor): Promise<void> {
    await (tx ?? this.db)
      .update(authSessions)
      .set({ isRevoked: true })
      .where(eq(authSessions.userId, userId));
  }
}
