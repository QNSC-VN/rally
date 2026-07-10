import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { InjectDrizzle } from '@platform';
import type { DrizzleDB, DbExecutor } from '@platform';
import type { AuthSession, CreateSessionInput, IAuthSessionRepository } from '@qnsc-vn/identity';
import { authSessions } from '../../../../../../db/schema/identity';
import { ssoProviderEnum } from '../../../../../../db/schema/enums';

type SsoProvider = (typeof ssoProviderEnum.enumValues)[number];

@Injectable()
export class AuthSessionDrizzleRepository implements IAuthSessionRepository<DbExecutor> {
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
      // rally stores the auth context (workspace) in the workspace_id column.
      contextId: row.workspaceId,
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
      // rally is workspace-scoped: contextId is always the (non-null) workspace id.
      workspaceId: input.contextId as string,
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

  async revokeByIdIfActive(id: string, tx?: DbExecutor): Promise<boolean> {
    // Conditional update = optimistic compare-and-swap. Only the request that
    // observes is_revoked=false flips it and gets a row back; concurrent racers
    // get zero rows and must not create a competing session.
    const rows = await (tx ?? this.db)
      .update(authSessions)
      .set({ isRevoked: true })
      .where(and(eq(authSessions.id, id), eq(authSessions.isRevoked, false)))
      .returning({ id: authSessions.id });
    return rows.length > 0;
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
