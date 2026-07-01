import { Injectable } from '@nestjs/common';
import { and, eq, isNull, lt } from 'drizzle-orm';
import { InjectDrizzle, buildPageResult } from '@platform';
import type { DrizzleDB, DbExecutor, CursorPayload, PagedResult } from '@platform';
import { workspaces } from '../../../../../../db/schema/tenancy';
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

  async findBySlug(tenantId: string, slug: string): Promise<Workspace | null> {
    const rows = await this.db
      .select()
      .from(workspaces)
      .where(
        and(
          eq(workspaces.tenantId, tenantId),
          eq(workspaces.slug, slug),
          isNull(workspaces.deletedAt),
        ),
      )
      .limit(1);
    return (rows[0] as Workspace | undefined) ?? null;
  }

  async listByTenant(
    tenantId: string,
    { limit, cursor }: { limit: number; cursor: CursorPayload | null },
  ): Promise<PagedResult<Workspace>> {
    const conditions = [eq(workspaces.tenantId, tenantId), isNull(workspaces.deletedAt)];

    if (cursor) {
      conditions.push(lt(workspaces.createdAt, new Date(cursor.k[0] as string)));
    }

    const rows = await this.db
      .select()
      .from(workspaces)
      .where(and(...conditions))
      .orderBy(workspaces.createdAt)
      .limit(limit + 1);

    return buildPageResult(rows as Workspace[], limit, (w) => [w.createdAt.toISOString()]);
  }

  async create(input: CreateWorkspaceInput, tx?: DbExecutor): Promise<Workspace> {
    const rows = await (tx ?? this.db)
      .insert(workspaces)
      .values({
        id: input.id,
        tenantId: input.tenantId,
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
