import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { InjectDrizzle } from '@platform';
import type { DrizzleDB, DbExecutor } from '@platform';
import { workspaceSettings } from '../../../../../../db/schema/workspace';
import type { WorkspaceSettings, UpdateWorkspaceSettingsInput } from '../../domain/workspace.types';
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
    return rows[0] ?? null;
  }

  async upsert(
    workspaceId: string,
    input: UpdateWorkspaceSettingsInput,
    tx?: DbExecutor,
  ): Promise<WorkspaceSettings> {
    const db = tx ?? this.db;
    const existing = await this.findByWorkspace(workspaceId);

    if (existing) {
      const rows = await db
        .update(workspaceSettings)
        .set({
          ...(input.timezone !== undefined && { timezone: input.timezone }),
          ...(input.defaultLocale !== undefined && { defaultLocale: input.defaultLocale }),
          ...(input.dateFormat !== undefined && { dateFormat: input.dateFormat }),
          // MERGED over what is stored, not replaced: the request carries only the sizes the
          // operator edited, so a replace would blank every size they left alone.
          ...(input.preliminaryEstimateMap !== undefined && {
            preliminaryEstimateMap: {
              ...(existing.preliminaryEstimateMap ?? {}),
              ...input.preliminaryEstimateMap,
            },
          }),
          updatedAt: new Date(),
        })
        .where(eq(workspaceSettings.workspaceId, workspaceId))
        .returning();
      return rows[0];
    }

    const rows = await db
      .insert(workspaceSettings)
      .values({
        workspaceId,
        timezone: input.timezone ?? 'UTC',
        defaultLocale: input.defaultLocale ?? 'en',
        dateFormat: input.dateFormat ?? null,
        // `{}` is the column default and means "use the seeded map" to the reader, so an
        // insert without an explicit map stays on the default rather than freezing a copy.
        preliminaryEstimateMap: input.preliminaryEstimateMap ?? {},
      })
      .returning();
    return rows[0];
  }
}
