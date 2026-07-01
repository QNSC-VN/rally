import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { InjectDrizzle } from '@platform';
import type { DrizzleDB } from '@platform';
import { workspaceSettings } from '../../../../../../db/schema/tenancy';
import type { WorkspaceSettings, UpdateWorkspaceSettingsInput } from '../../domain/tenancy.types';
import { IWorkspaceSettingsRepository } from '../../domain/ports/workspace-settings.repository';

@Injectable()
export class WorkspaceSettingsDrizzleRepository implements IWorkspaceSettingsRepository {
  constructor(@InjectDrizzle() private readonly db: DrizzleDB) {}

  async findByWorkspace(workspaceId: string): Promise<WorkspaceSettings | null> {
    const rows = await this.db
      .select()
      .from(workspaceSettings)
      .where(eq(workspaceSettings.workspaceId, workspaceId))
      .limit(1);
    return (rows[0] as WorkspaceSettings | undefined) ?? null;
  }

  async upsert(
    workspaceId: string,
    tenantId: string,
    input: UpdateWorkspaceSettingsInput,
  ): Promise<WorkspaceSettings> {
    const existing = await this.findByWorkspace(workspaceId);

    if (existing) {
      const rows = await this.db
        .update(workspaceSettings)
        .set({
          ...(input.timezone !== undefined && { timezone: input.timezone }),
          ...(input.defaultLocale !== undefined && { defaultLocale: input.defaultLocale }),
          ...(input.dateFormat !== undefined && { dateFormat: input.dateFormat }),
          updatedAt: new Date(),
        })
        .where(eq(workspaceSettings.workspaceId, workspaceId))
        .returning();
      return rows[0] as WorkspaceSettings;
    }

    const rows = await this.db
      .insert(workspaceSettings)
      .values({
        workspaceId,
        tenantId,
        timezone: input.timezone ?? 'UTC',
        defaultLocale: input.defaultLocale ?? 'en',
        dateFormat: input.dateFormat ?? null,
      })
      .returning();
    return rows[0] as WorkspaceSettings;
  }
}
