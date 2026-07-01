/**
 * CleanupCronService — periodic housekeeping for stale / soft-deleted rows.
 *
 * Runs daily at 01:00 UTC (stagger from snapshot cron at 00:00).
 * Purges:
 *   1. identity.auth_sessions that are revoked and expired >N days ago
 *   2. identity.password_reset_tokens that expired >1 day ago
 *   3. tenancy.workspace_invitations that are still 'pending' but expired >N days ago
 *   4. work.attachments that are still 'pending' (never confirmed) older than 24 h
 *      — hard-deletes the DB row then best-effort deletes the S3 object
 *
 * N is configured via SESSION_CLEANUP_OLDER_THAN_DAYS (default 7).
 */
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { sql } from 'drizzle-orm';
import { InjectDrizzle, AppConfigService, StorageService, ValkeyService } from '@platform';
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
    private readonly valkey: ValkeyService,
  ) {}

  @Cron('0 1 * * *', { name: 'daily-cleanup', timeZone: 'UTC' })
  async runCleanup(): Promise<void> {
    const acquired = await this.valkey.acquireLock('cron:daily-cleanup', this.LOCK_TTL_MS);
    if (!acquired) {
      this.logger.warn('Cleanup cron lock held by another pod — skipping this tick');
      return;
    }
    try {
      await this.purgeStaleData();
    } finally {
      await this.valkey.releaseLock('cron:daily-cleanup');
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

    // 2. Used / expired password reset tokens (>1 day past expiry)
    const prtResult = await this.db.execute(
      sql`
        DELETE FROM identity.password_reset_tokens
        WHERE expires_at < NOW() - INTERVAL '1 day'
      `,
    );
    this.logger.log(
      { deleted: (prtResult as { rowCount?: number }).rowCount },
      'Purged expired password reset tokens',
    );

    // 3. Expired pending invitations
    const invResult = await this.db.execute(
      sql`
        UPDATE tenancy.workspace_invitations
        SET status = 'expired', updated_at = NOW()
        WHERE status = 'pending'
          AND expires_at < NOW()
      `,
    );
    this.logger.log(
      { updated: (invResult as { rowCount?: number }).rowCount },
      'Expired stale workspace invitations',
    );

    // 4. Orphan attachments — pending rows older than 24 h (client presigned but
    //    never called /confirm). Hard-delete from DB first, then best-effort
    //    remove the S3 objects so abandoned uploads don't accumulate.
    const orphanRows = await this.db.execute<{ id: string; storage_key: string }>(
      sql`
        DELETE FROM work.attachments
        WHERE status = 'pending'
          AND created_at < NOW() - INTERVAL '24 hours'
          AND deleted_at IS NULL
        RETURNING id, storage_key
      `,
    );
    const orphans = (orphanRows as unknown as { rows: { id: string; storage_key: string }[] }).rows ?? [];

    if (orphans.length > 0) {
      // Fire S3 deletes in parallel — failures are logged inside deleteObject, never thrown.
      await Promise.allSettled(orphans.map((row) => this.storageService.deleteObject(row.storage_key)));
      this.logger.log({ deleted: orphans.length }, 'Purged orphan pending attachments');
    }
  }
}
