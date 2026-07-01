import { Injectable } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import { InjectDrizzle } from '@platform';
import type { DrizzleDB } from '@platform';
import { notificationPreferences } from '../../../../../../db/schema/notifications';
import type { INotificationPreferenceRepository } from '../../domain/ports/notification-preference.repository';
import type {
  NotificationPreference,
  UpsertPreferenceInput,
} from '../../domain/notification-preference.types';

@Injectable()
export class NotificationPreferenceDrizzleRepository implements INotificationPreferenceRepository {
  constructor(@InjectDrizzle() private readonly db: DrizzleDB) {}

  async listForUser(tenantId: string, userId: string): Promise<NotificationPreference[]> {
    const rows = await this.db
      .select()
      .from(notificationPreferences)
      .where(
        and(
          eq(notificationPreferences.tenantId, tenantId),
          eq(notificationPreferences.userId, userId),
        ),
      );
    return rows.map(this.mapRow);
  }

  async findOne(
    tenantId: string,
    userId: string,
    type: string,
  ): Promise<NotificationPreference | null> {
    const [row] = await this.db
      .select()
      .from(notificationPreferences)
      .where(
        and(
          eq(notificationPreferences.tenantId, tenantId),
          eq(notificationPreferences.userId, userId),
          eq(notificationPreferences.type, type),
        ),
      )
      .limit(1);
    return row ? this.mapRow(row) : null;
  }

  async findForCheck(
    tenantId: string,
    userId: string,
    type: string,
  ): Promise<NotificationPreference[]> {
    // Fetches the specific type row AND the wildcard row in a single query.
    // Returns 0-2 rows; callers resolve priority (specific > wildcard > default).
    const rows = await this.db
      .select()
      .from(notificationPreferences)
      .where(
        and(
          eq(notificationPreferences.tenantId, tenantId),
          eq(notificationPreferences.userId, userId),
          inArray(notificationPreferences.type, [type, '*']),
        ),
      );
    return rows.map(this.mapRow);
  }

  async upsert(input: UpsertPreferenceInput): Promise<NotificationPreference> {
    const [row] = await this.db
      .insert(notificationPreferences)
      .values({
        tenantId: input.tenantId,
        userId: input.userId,
        type: input.type,
        inApp: input.inApp ?? true,
        email: input.email ?? true,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [
          notificationPreferences.tenantId,
          notificationPreferences.userId,
          notificationPreferences.type,
        ],
        set: {
          ...(input.inApp !== undefined ? { inApp: input.inApp } : {}),
          ...(input.email !== undefined ? { email: input.email } : {}),
          updatedAt: new Date(),
        },
      })
      .returning();
    return this.mapRow(row);
  }

  async delete(tenantId: string, userId: string, type: string): Promise<void> {
    await this.db
      .delete(notificationPreferences)
      .where(
        and(
          eq(notificationPreferences.tenantId, tenantId),
          eq(notificationPreferences.userId, userId),
          eq(notificationPreferences.type, type),
        ),
      );
  }

  private mapRow(row: typeof notificationPreferences.$inferSelect): NotificationPreference {
    return {
      id: row.id,
      tenantId: row.tenantId,
      userId: row.userId,
      type: row.type,
      inApp: row.inApp,
      email: row.email,
      updatedAt: row.updatedAt,
    };
  }
}
