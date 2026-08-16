import { Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, isNull } from 'drizzle-orm';
import { InjectDrizzle, buildPageResult, keysetCondition } from '@platform';
import type { DrizzleDB, DbExecutor, CursorPayload, PagedResult } from '@platform';
import { workspaces, workspaceMembers } from '../../../../../../db/schema/workspace';
import type {
  Workspace,
  CreateWorkspaceInput,
  UpdateWorkspaceInput,
} from '../../domain/workspace.types';
import { IWorkspaceRepository } from '../../domain/ports/workspace.repository';

@Injectable()
export class WorkspaceDrizzleRepository implements IWorkspaceRepository {
  constructor(@InjectDrizzle() private readonly db: DrizzleDB) {}

  async findById(id: string): Promise<Workspace | null> {
    const rows = await this.db.select().from(workspaces).where(eq(workspaces.id, id)).limit(1);
    return (rows[0] as Workspace | undefined) ?? null;
  }

  async listForUser(
    userId: string,
    { limit, cursor }: { limit: number; cursor: CursorPayload | null },
  ): Promise<PagedResult<Workspace>> {
    const conditions = [
      eq(workspaceMembers.userId, userId),
      eq(workspaceMembers.status, 'active'),
      isNull(workspaces.deletedAt),
    ];

    if (cursor) {
      conditions.push(keysetCondition(workspaces.createdAt, workspaces.id, cursor));
    }

    const rows = await this.db
      .select({ ws: workspaces })
      .from(workspaceMembers)
      .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
      .where(and(...conditions))
      .orderBy(desc(workspaces.createdAt), asc(workspaces.id))
      .limit(limit + 1);

    // 'desc' must match the ORDER BY — keysetCondition reads cursor.d.
    return buildPageResult(
      rows.map((r) => r.ws as Workspace),
      limit,
      (w) => [w.createdAt.toISOString()],
      'desc',
    );
  }

  async listAll(): Promise<Workspace[]> {
    const rows = await this.db
      .select()
      .from(workspaces)
      .where(isNull(workspaces.deletedAt))
      .orderBy(workspaces.createdAt, asc(workspaces.id));
    return rows as Workspace[];
  }

  async count(): Promise<number> {
    const rows = await this.db
      .select({ cnt: count() })
      .from(workspaces)
      .where(isNull(workspaces.deletedAt));
    return Number(rows[0]?.cnt ?? 0);
  }

  async create(input: CreateWorkspaceInput, tx?: DbExecutor): Promise<Workspace> {
    const rows = await (tx ?? this.db)
      .insert(workspaces)
      .values({
        id: input.id,
        slug: input.slug,
        name: input.name,
        description: input.description,
        avatarUrl: input.avatarUrl,
      })
      .returning();
    return rows[0] as Workspace;
  }

  async update(id: string, input: UpdateWorkspaceInput, tx?: DbExecutor): Promise<Workspace> {
    const rows = await (tx ?? this.db)
      .update(workspaces)
      .set({
        ...(input.name !== undefined && { name: input.name }),
        ...(input.description !== undefined && { description: input.description }),
        ...(input.avatarUrl !== undefined && { avatarUrl: input.avatarUrl }),
        ...(input.settings !== undefined && { settings: input.settings }),
        updatedAt: new Date(),
      })
      .where(eq(workspaces.id, id))
      .returning();
    return rows[0] as Workspace;
  }
}
