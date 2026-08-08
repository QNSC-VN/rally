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
 * module, which owns the same rules the read path serves. This class is only the schedule;
 * the cross-pod lock, the job context and the duration/outcome metrics come from
 * {@link ExclusiveJob}.
 */
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ExclusiveJob } from '@platform';
import { ReportSnapshotService } from '@modules/reporting';

@Injectable()
export class SnapshotCronService {
  private readonly logger = new Logger(SnapshotCronService.name);
  /** Lock TTL: 55 min — slightly less than the 1h cron interval. */
  private readonly LOCK_TTL_MS = 55 * 60 * 1_000;

  constructor(
    private readonly snapshots: ReportSnapshotService,
    private readonly exclusive: ExclusiveJob,
  ) {}

  /**
   * Hourly, five past — offset from the hour so it does not contend with every other
   * on-the-hour job for the same connections.
   */
  @Cron('5 * * * *', { name: 'report-snapshot', timeZone: 'UTC' })
  async takeSnapshots(): Promise<void> {
    // ExclusiveJob owns the lock, the job context and the duration/outcome metrics — this
    // class and CleanupCronService hand-rolled the identical sequence.
    await this.exclusive.run('report-snapshot', this.LOCK_TTL_MS, async () => {
      const result = await this.snapshots.takeSnapshots();
      this.logger.log(
        `Report snapshots complete — ${result.iterationsSnapshotted} iterations, ` +
          `${result.releasesSnapshotted} release rows, ${result.baselinesCaptured} baselines, ` +
          `${result.failures} failed`,
      );
    });
  }
}
