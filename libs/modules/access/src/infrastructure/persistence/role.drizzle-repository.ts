import { Injectable } from '@nestjs/common';
import { eq, or, isNull } from 'drizzle-orm';
import { InjectDrizzle } from '@platform';
import type { DrizzleDB, DbExecutor } from '@platform';
import { systemRoles } from '../../../../../../db/schema/access';
import type { SystemRole } from '../../domain/access.types';
import { IRoleRepository } from '../../domain/ports/role.repository';

@Injectable()
export class RoleDrizzleRepository implements IRoleRepository {
  constructor(@InjectDrizzle() private readonly db: DrizzleDB) {}

  async findById(id: string): Promise<SystemRole | null> {
    const rows = await this.db.select().from(systemRoles).where(eq(systemRoles.id, id)).limit(1);
    return rows[0] ? this.toRole(rows[0]) : null;
  }

  async listForWorkspace(workspaceId: string): Promise<SystemRole[]> {
    // Global template roles (workspaceId IS NULL) + this workspace's own roles.
    // A workspace may own an EDITABLE copy of a tier role that shares a slug with
    // the global template — collapse by slug, always preferring the workspace
    // copy so the admin sees (and edits) the row that actually governs the
    // workspace. Slugs unique to the global set (e.g. workspace_admin, which has
    // no per-workspace copy) fall through unchanged.
    const rows = await this.db
      .select()
      .from(systemRoles)
      .where(or(isNull(systemRoles.workspaceId), eq(systemRoles.workspaceId, workspaceId)));

    const bySlug = new Map<string, typeof systemRoles.$inferSelect>();
    for (const row of rows) {
      const existing = bySlug.get(row.slug);
      if (!existing || row.workspaceId === workspaceId) bySlug.set(row.slug, row);
    }
    return [...bySlug.values()].map((r) => this.toRole(r));
  }

  async updatePermissions(id: string, permissions: string[], tx?: DbExecutor): Promise<SystemRole> {
    const rows = await (tx ?? this.db)
      .update(systemRoles)
      .set({ permissions })
      .where(eq(systemRoles.id, id))
      .returning();
    return this.toRole(rows[0]);
  }

  private toRole(row: typeof systemRoles.$inferSelect): SystemRole {
    return {
      id: row.id,
      workspaceId: row.workspaceId,
      name: row.name,
      slug: row.slug,
      description: row.description,
      isSystem: row.isSystem,
      permissions: row.permissions as string[],
      createdAt: row.createdAt,
    };
  }
}
