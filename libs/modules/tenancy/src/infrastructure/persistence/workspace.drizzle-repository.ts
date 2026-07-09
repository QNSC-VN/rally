import { Injectable } from '@nestjs/common';
import { and, count, desc, eq, isNull, lt } from 'drizzle-orm';
import { InjectDrizzle, buildPageResult } from '@platform';
import type { DrizzleDB, DbExecutor, CursorPayload, PagedResult } from '@platform';
import { workspaces, workspaceMembers } from '../../../../../../db/schema/tenancy';
import type {
  Workspace,
  CreateWorkspaceInput,
  UpdateWorkspaceInput,
} from '../../domain/tenancy.types';
import { IWorkspaceRepository } from '../../domain/ports/workspace.repository';

@Injectable()
export class WorkspaceDrizzleRepository implements IWorkspaceRepository {
  constructor(@InjectDrizzle() private readonly db: DrizzleDB) {}

  async findById(id: string): Promise<Workspace | null> {
    const rows = await this.db.select().from(workspaces).where(eq(workspaces.id, id)).limit(1);
    return (rows[0] as Workspace | undefined) ?? null;
  }

  async findBySlug(slug: string): Promise<Workspace | null> {
    const rows = await this.db
      .select()
      .from(workspaces)
      .where(and(eq(workspaces.slug, slug), isNull(workspaces.deletedAt)))
      .limit(1);
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
      conditions.push(lt(workspaces.createdAt, new Date(cursor.k[0] as string)));
    }

    const rows = await this.db
      .select({ ws: workspaces })
      .from(workspaceMembers)
      .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
      .where(and(...conditions))
      .orderBy(desc(workspaces.createdAt))
      .limit(limit + 1);

    return buildPageResult(
      rows.map((r) => r.ws as Workspace),
      limit,
      (w) => [w.createdAt.toISOString()],
    );
  }

  async listAll(): Promise<Workspace[]> {
    const rows = await this.db
      .select()
      .from(workspaces)
      .where(isNull(workspaces.deletedAt))
      .orderBy(workspaces.createdAt);
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

  async update(id: string, input: UpdateWorkspaceInput): Promise<Workspace> {
    const rows = await this.db
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

  async softDelete(id: string): Promise<void> {
    await this.db
      .update(workspaces)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(workspaces.id, id));
  }
}
