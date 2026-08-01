/**
 * SnapshotCronService — the frozen daily history behind Iteration Burndown and the Release
 * Tracking burnup.
 *
 * Runs HOURLY, not once at UTC midnight. Date cutoffs are per workspace
 * (`workspace_settings.timezone`), so a single UTC-midnight tick captured the wrong moment
 * for every workspace not on UTC — which is exactly what the previous implementation did.
 * Each tick writes the workspace's CURRENT local date, so the value that survives a day is
 * the one from the last tick before that workspace's midnight, and the moment the local date
 * rolls over the previous day stops being addressed by any write and is frozen.
 *
 * All measurement and persistence live in `ReportSnapshotService` inside the reporting
 * module, which owns the same rules the read path serves. This class is only the schedule:
 * the cross-pod lock, the job context, and the duration/outcome metrics.
 */
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { CacheService } from '@platform';
import { ReportSnapshotService } from '@modules/reporting';
import { JobMetrics, withJobContext } from '@qnsc-vn/observability';

@Injectable()
export class SnapshotCronService {
  private readonly logger = new Logger(SnapshotCronService.name);
  /** Lock TTL: 55 min — slightly less than the 1h cron interval. */
  private readonly LOCK_TTL_MS = 55 * 60 * 1_000;

  constructor(
    private readonly snapshots: ReportSnapshotService,
    private readonly cache: CacheService,
    private readonly jobMetrics: JobMetrics,
  ) {}

  /**
   * Hourly, five past — offset from the hour so it does not contend with every other
   * on-the-hour job for the same connections.
   */
  @Cron('5 * * * *', { name: 'report-snapshot', timeZone: 'UTC' })
  async takeSnapshots(): Promise<void> {
    // Job context so every line this run logs carries a correlationId (cron work otherwise
    // has none at all), plus duration/outcome metrics so a job that starts failing or slowing
    // is visible without reading logs.
    await withJobContext('report-snapshot', () =>
      this.jobMetrics.time('report-snapshot', () => this.runLocked()),
    );
  }

  private async runLocked(): Promise<void> {
    const acquired = await this.cache.acquireLock('cron:report-snapshot', this.LOCK_TTL_MS);
    if (!acquired) {
      this.logger.warn('Report snapshot lock held by another pod — skipping this tick');
      return;
    }
    try {
      const result = await this.snapshots.takeSnapshots();
      this.logger.log(
        `Report snapshots complete — ${result.iterationsSnapshotted} iterations, ` +
          `${result.releasesSnapshotted} release rows, ${result.baselinesCaptured} baselines, ` +
          `${result.failures} failed`,
      );
    } finally {
      await this.cache.releaseLock('cron:report-snapshot');
    }
  }
}
