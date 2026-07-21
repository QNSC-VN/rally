/**
 * CleanupCronService — periodic housekeeping for stale / soft-deleted rows.
 *
 * Runs daily at 01:00 UTC (stagger from snapshot cron at 00:00).
 * Purges:
 *   1. identity.auth_sessions that are revoked and expired >N days ago
 *   2. workspace.workspace_invitations that are still 'pending' but expired >N days ago
 *   3. storage.files that are unreachable — either presigned but never confirmed
 *      (older than 24 h), or soft-deleted, or no longer referenced by any link
 *      table. Deletes the object, then the row.
 *
 * N is configured via SESSION_CLEANUP_OLDER_THAN_DAYS (default 7).
 */
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { sql } from 'drizzle-orm';
import { InjectDrizzle, AppConfigService, StorageService, CacheService } from '@platform';
import type { DrizzleDB } from '@platform';

@Injectable()
export class CleanupCronService {
  private readonly logger = new Logger(CleanupCronService.name);
  /** Lock TTL: 55 min — slightly less than the 1h cron interval to avoid overlap. */
  private readonly LOCK_TTL_MS = 55 * 60 * 1_000;

  constructor(
    @InjectDrizzle() private readonly db: DrizzleDB,
    private readonly config: AppConfigService,
    private readonly storageService: StorageService,
    private readonly cache: CacheService,
  ) {}

  @Cron('0 1 * * *', { name: 'daily-cleanup', timeZone: 'UTC' })
  async runCleanup(): Promise<void> {
    const acquired = await this.cache.acquireLock('cron:daily-cleanup', this.LOCK_TTL_MS);
    if (!acquired) {
      this.logger.warn('Cleanup cron lock held by another pod — skipping this tick');
      return;
    }
    try {
      await this.purgeStaleData();
    } finally {
      await this.cache.releaseLock('cron:daily-cleanup');
    }
  }

  private async purgeStaleData(): Promise<void> {
    const olderThanDays = this.config.get('SESSION_CLEANUP_OLDER_THAN_DAYS');
    this.logger.log(`Running daily cleanup (session retention=${olderThanDays}d)`);

    // 1. Revoked sessions past retention window
    const sessionResult = await this.db.execute(
      sql`
        DELETE FROM identity.auth_sessions
        WHERE is_revoked = true
          AND expires_at < NOW() - (${olderThanDays} || ' days')::interval
      `,
    );
    this.logger.log(
      { deleted: (sessionResult as { rowCount?: number }).rowCount },
      'Purged stale auth sessions',
    );

    // 2. Expired pending invitations
    const invResult = await this.db.execute(
      sql`
        UPDATE workspace.workspace_invitations
        SET status = 'expired', updated_at = NOW()
        WHERE status = 'pending'
          AND expires_at < NOW()
      `,
    );
    this.logger.log(
      { updated: (invResult as { rowCount?: number }).rowCount },
      'Expired stale workspace invitations',
    );

    // 3. Unreachable storage.files — the single place objects are deleted.
    //
    // Three ways a file becomes unreachable, all handled by one sweep so a file
    // cannot slip between them:
    //   a) pending  — presigned but /confirm never called (client abandoned)
    //   b) soft-deleted — the owner called DELETE
    //   c) unreferenced — every link row is gone (e.g. its work item was
    //      deleted, which cascaded the link but not the file)
    //
    // (c) is why deletion lives here rather than in the request path: a file may
    // be referenced by more than one link row, and only a sweep can see that the
    // last reference has gone. Add a NOT EXISTS clause per new link table.
    //
    // Objects are deleted BEFORE the rows: a failed object delete leaves the row
    // for the next run to retry. The reverse order would drop the only record of
    // the key and leak the object permanently.
    const unreachable = await this.db.execute<{
      id: string;
      storage_key: string;
      visibility: string;
    }>(
      sql`
        SELECT f.id, f.storage_key, f.visibility
        FROM storage.files f
        WHERE
          (f.status = 'pending' AND f.created_at < NOW() - INTERVAL '24 hours')
          OR f.deleted_at IS NOT NULL
          OR (
            f.status = 'completed'
            -- Grace period: a file is legitimately unreferenced between /confirm
            -- and the caller writing its link row. Without this the sweep would
            -- race an in-flight upload.
            AND f.confirmed_at < NOW() - INTERVAL '1 hour'
            AND NOT EXISTS (
              SELECT 1 FROM work.work_item_attachments l WHERE l.file_id = f.id
            )
          )
        LIMIT 1000
      `,
    );
    const rows =
      (
        unreachable as unknown as {
          rows: { id: string; storage_key: string; visibility: string }[];
        }
      ).rows ?? [];

    if (rows.length > 0) {
      const results = await Promise.allSettled(
        rows.map((r) =>
          this.storageService.deleteObject(
            r.storage_key,
            r.visibility === 'public' ? 'public' : 'private',
          ),
        ),
      );
      // deleteObject swallows its own errors, so a rejection here is unexpected —
      // keep those rows for the next run rather than dropping the key.
      const deletedIds = rows.filter((_, i) => results[i].status === 'fulfilled').map((r) => r.id);

      if (deletedIds.length > 0) {
        await this.db.execute(
          sql`DELETE FROM storage.files WHERE id = ANY(${sql.param(deletedIds)}::uuid[])`,
        );
      }
      this.logger.log(
        { swept: rows.length, deleted: deletedIds.length },
        'Purged unreachable storage files',
      );
    }
  }
}
