import { Injectable } from '@nestjs/common';
import { eq, or, isNull } from 'drizzle-orm';
import { InjectDrizzle } from '@platform';
import type { DrizzleDB } from '@platform';
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

  async listForTenant(tenantId: string): Promise<SystemRole[]> {
    // Return global system roles (tenantId IS NULL) + tenant-specific roles
    const rows = await this.db
      .select()
      .from(systemRoles)
      .where(or(isNull(systemRoles.tenantId), eq(systemRoles.tenantId, tenantId)));
    return rows.map((r) => this.toRole(r));
  }

  private toRole(row: typeof systemRoles.$inferSelect): SystemRole {
    return {
      id: row.id,
      tenantId: row.tenantId,
      name: row.name,
      slug: row.slug,
      description: row.description,
      isSystem: row.isSystem,
      permissions: row.permissions as string[],
      createdAt: row.createdAt,
    };
  }
}
