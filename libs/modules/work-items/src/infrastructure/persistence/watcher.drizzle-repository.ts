import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { InjectDrizzle } from '@platform';
import type { DrizzleDB } from '@platform';
import { workItemWatchers } from '../../../../../../db/schema/work';
import type { Watcher } from '../../domain/watcher.types';
import type { IWatcherRepository } from '../../domain/ports/watcher.repository';

@Injectable()
export class WatcherDrizzleRepository implements IWatcherRepository {
  constructor(@InjectDrizzle() private readonly db: DrizzleDB) {}

  async listByWorkItem(workItemId: string, tenantId: string): Promise<Watcher[]> {
    const rows = await this.db
      .select()
      .from(workItemWatchers)
      .where(
        and(eq(workItemWatchers.workItemId, workItemId), eq(workItemWatchers.tenantId, tenantId)),
      );
    return rows as Watcher[];
  }

  async isWatching(workItemId: string, userId: string): Promise<boolean> {
    const rows = await this.db
      .select({ workItemId: workItemWatchers.workItemId })
      .from(workItemWatchers)
      .where(and(eq(workItemWatchers.workItemId, workItemId), eq(workItemWatchers.userId, userId)))
      .limit(1);
    return rows.length > 0;
  }

  async watch(workItemId: string, userId: string, tenantId: string): Promise<void> {
    await this.db
      .insert(workItemWatchers)
      .values({ workItemId, userId, tenantId })
      .onConflictDoNothing();
  }

  async unwatch(workItemId: string, userId: string): Promise<void> {
    await this.db
      .delete(workItemWatchers)
      .where(and(eq(workItemWatchers.workItemId, workItemId), eq(workItemWatchers.userId, userId)));
  }

  async watchMany(workItemId: string, userIds: string[], tenantId: string): Promise<void> {
    if (userIds.length === 0) return;
    await this.db
      .insert(workItemWatchers)
      .values(userIds.map((userId) => ({ workItemId, userId, tenantId })))
      .onConflictDoNothing();
  }

  async listUserIds(workItemId: string): Promise<string[]> {
    const rows = await this.db
      .select({ userId: workItemWatchers.userId })
      .from(workItemWatchers)
      .where(eq(workItemWatchers.workItemId, workItemId));
    return rows.map((r) => r.userId);
  }
}
