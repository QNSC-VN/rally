import { Injectable } from '@nestjs/common';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';

import { InjectDrizzle } from '@platform';
import type { DrizzleDB } from '@platform';

import { apiTokens } from '../../../../../../db/schema/identity';

export interface ApiTokenRow {
  id: string;
  workspaceId: string;
  userId: string;
  name: string;
  prefix: string;
  tokenHash: string;
  scopes: string[] | null;
  expiresAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

export interface CreateApiTokenInput {
  workspaceId: string;
  userId: string;
  name: string;
  prefix: string;
  tokenHash: string;
  scopes: string[] | null;
  expiresAt: Date;
}

/** How stale `last_used_at` may be before a use writes it again. */
const LAST_USED_THROTTLE_MS = 60_000;

@Injectable()
export class ApiTokenDrizzleRepository {
  constructor(@InjectDrizzle() private readonly db: DrizzleDB) {}

  async create(input: CreateApiTokenInput): Promise<ApiTokenRow> {
    // Columns named rather than spread: `workspace_id` is the whole isolation boundary in this schema
    // (there is no RLS), and `.values(input)` hides whether it was written at all — from a reader and
    // from `test/workspace-scope.ratchet.spec.ts`, which is the only thing standing between a new query
    // and a silently unscoped one.
    const rows = await this.db
      .insert(apiTokens)
      .values({
        workspaceId: input.workspaceId,
        userId: input.userId,
        name: input.name,
        prefix: input.prefix,
        tokenHash: input.tokenHash,
        scopes: input.scopes,
        expiresAt: input.expiresAt,
      })
      .returning();
    return rows[0];
  }

  /**
   * Look up by prefix — the authentication hot path.
   *
   * By prefix and not by hash, even though both are unique: the caller still has to compare hashes in
   * constant time, and doing the lookup on the hash would make the query itself the comparison, which
   * is a database-level equality test with no timing guarantees at all.
   */
  async findByPrefix(prefix: string): Promise<ApiTokenRow | null> {
    const rows = await this.db
      .select()
      .from(apiTokens)
      .where(eq(apiTokens.prefix, prefix))
      .limit(1);
    return rows[0] ?? null;
  }

  /** Every token belonging to one user, newest first. Revoked ones included — see the controller. */
  async listForUser(workspaceId: string, userId: string): Promise<ApiTokenRow[]> {
    return await this.db
      .select()
      .from(apiTokens)
      .where(and(eq(apiTokens.workspaceId, workspaceId), eq(apiTokens.userId, userId)))
      // `id` breaks the tie: two tokens minted in the same millisecond would otherwise come back in
      // physical-tuple order, which changes on the next UPDATE — `touch` writes on every use.
      .orderBy(desc(apiTokens.createdAt), desc(apiTokens.id));
  }

  /** Every LIVE token in a workspace — the administrator's offboarding view. */
  async listActiveForWorkspace(workspaceId: string): Promise<ApiTokenRow[]> {
    return await this.db
      .select()
      .from(apiTokens)
      .where(and(eq(apiTokens.workspaceId, workspaceId), isNull(apiTokens.revokedAt)))
      .orderBy(desc(apiTokens.createdAt), desc(apiTokens.id));
  }

  async findById(workspaceId: string, id: string): Promise<ApiTokenRow | null> {
    const rows = await this.db
      .select()
      .from(apiTokens)
      .where(and(eq(apiTokens.workspaceId, workspaceId), eq(apiTokens.id, id)))
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * Revoke, idempotently: `WHERE revoked_at IS NULL` means a second call is a no-op rather than a
   * silent re-dating of the first revocation, which is the field an incident review reads.
   */
  async revoke(workspaceId: string, id: string, at: Date): Promise<boolean> {
    const rows = await this.db
      .update(apiTokens)
      .set({ revokedAt: at })
      .where(
        and(
          eq(apiTokens.workspaceId, workspaceId),
          eq(apiTokens.id, id),
          isNull(apiTokens.revokedAt),
        ),
      )
      .returning({ id: apiTokens.id });
    return rows.length > 0;
  }

  /** Revoke every live token of one user. The offboarding path. */
  async revokeAllForUser(workspaceId: string, userId: string, at: Date): Promise<number> {
    const rows = await this.db
      .update(apiTokens)
      .set({ revokedAt: at })
      .where(
        and(
          eq(apiTokens.workspaceId, workspaceId),
          eq(apiTokens.userId, userId),
          isNull(apiTokens.revokedAt),
        ),
      )
      .returning({ id: apiTokens.id });
    return rows.length;
  }

  /**
   * Record a use, at most once a minute per token.
   *
   * The throttle is in the WHERE clause rather than in the service so it holds across replicas without
   * coordination: two API instances handling the same token in the same second issue the same
   * conditional update and one of them changes nothing. Without it, authentication — a read — would
   * write a row on every single request, and `last_used_at` is a forensic field, not a counter.
   */
  async touch(workspaceId: string, id: string, at: Date): Promise<void> {
    await this.db
      .update(apiTokens)
      .set({ lastUsedAt: at })
      .where(
        and(
          // Carries its own workspace predicate even though `id` is a primary key: the caller has just
          // read the row and knows its workspace, so there is no reason for this write to be the one
          // that relies on a service remembering to re-check.
          eq(apiTokens.workspaceId, workspaceId),
          eq(apiTokens.id, id),
          sql`(${apiTokens.lastUsedAt} IS NULL OR ${apiTokens.lastUsedAt} < ${new Date(
            at.getTime() - LAST_USED_THROTTLE_MS,
          )})`,
        ),
      );
  }
}
