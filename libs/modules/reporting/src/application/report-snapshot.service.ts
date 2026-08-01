import { Inject, Injectable, Logger } from '@nestjs/common';
import { PreliminaryEstimateMapService } from '@modules/portfolio';
import { IReportingRepository, REPORTING_REPOSITORY } from '../domain/ports/reporting.repository';
import {
  bucketFeatures,
  preliminaryTotal,
  releaseTotals,
  trackedLeaves,
  type ReleaseChild,
} from '../domain/release-tracking';
import { ALL_TEAMS, endOfWorkspaceDay, workspaceLocalDate } from '../domain/report-scope';

export interface SnapshotRunResult {
  iterationsSnapshotted: number;
  releasesSnapshotted: number;
  baselinesCaptured: number;
  failures: number;
}

/**
 * The daily history writer for Iteration Burndown and the Release Tracking burnup.
 *
 * WHY THIS EXISTS AT ALL
 *
 * Burndown cannot be reconstructed. Task To Do is overwritten in place, so yesterday's
 * remaining hours are simply gone unless something wrote them down. The SRS is emphatic that
 * a production screen must show an empty state instead of inventing a curve, and that the
 * mockup's `buildFallbackSnapshots` is prohibited. This service is the alternative.
 *
 * HOW "END OF DAY" IS ACHIEVED WITHOUT KNOWING EACH WORKSPACE'S MIDNIGHT
 *
 * Timestamps are per workspace, and a single UTC-midnight job would capture the wrong moment
 * for every workspace that is not on UTC — the previous implementation ran at `0 0 * * *` UTC
 * for exactly that reason and was wrong for all of them.
 *
 * So the job runs HOURLY and always writes the workspace's CURRENT local date. Each write
 * replaces that day's row, so the value that survives is the one from the last tick before
 * local midnight — which is the end-of-day value the contract asks for. The moment the local
 * date rolls over, the previous date stops being addressed by any write and is frozen; a
 * cheap UPDATE then marks it `finalized` so a reader can tell a finished day from one still
 * being written.
 *
 * What this deliberately does NOT do: backfill a day it missed. A gap stays a gap, and the
 * report renders it as unavailable (IB §5). Interpolating would be indistinguishable from
 * measured data.
 */
@Injectable()
export class ReportSnapshotService {
  private readonly logger = new Logger(ReportSnapshotService.name);

  constructor(
    @Inject(REPORTING_REPOSITORY) private readonly repo: IReportingRepository,
    private readonly preliminaryEstimates: PreliminaryEstimateMapService,
  ) {}

  async takeSnapshots(now = new Date()): Promise<SnapshotRunResult> {
    const result: SnapshotRunResult = {
      iterationsSnapshotted: 0,
      releasesSnapshotted: 0,
      baselinesCaptured: 0,
      failures: 0,
    };

    const [activeIterations, activeReleases] = await Promise.all([
      this.repo.findActiveIterations(),
      this.repo.findActiveReleases(),
    ]);

    // One settings read per workspace, not per iteration: every row in a workspace shares the
    // timezone and calendar, and the job touches every workspace on every tick.
    const workspaceIds = new Set([
      ...activeIterations.map((i) => i.workspaceId),
      ...activeReleases.map((r) => r.workspaceId),
    ]);
    const localDates = new Map<string, string>();
    const timeZones = new Map<string, string>();
    for (const workspaceId of workspaceIds) {
      const settings = await this.repo.getWorkspaceSettings(workspaceId);
      timeZones.set(workspaceId, settings.timeZone);
      localDates.set(workspaceId, workspaceLocalDate(now, settings.timeZone));
    }

    for (const iteration of activeIterations) {
      const localDate = localDates.get(iteration.workspaceId);
      const timeZone = timeZones.get(iteration.workspaceId);
      if (!localDate || !timeZone) continue;
      try {
        // The Ideal baseline is captured on the first tick that sees the iteration committed,
        // and never again — `captureStartBaseline` only writes when the column is still null.
        if (iteration.totalTaskEstimateAtStart === null) {
          const total = await this.repo.sumTaskEstimate(iteration.workspaceId, iteration.id);
          await this.repo.captureStartBaseline(iteration.workspaceId, iteration.id, total, now);
          result.baselinesCaptured += 1;
        }

        const measured = await this.repo.measureIterationDay(
          iteration.workspaceId,
          iteration.id,
          endOfWorkspaceDay(localDate, timeZone),
        );
        await this.repo.upsertIterationSnapshot({
          workspaceId: iteration.workspaceId,
          iterationId: iteration.id,
          snapshotDate: localDate,
          ...measured,
        });
        result.iterationsSnapshotted += 1;
      } catch (err) {
        result.failures += 1;
        // One iteration's failure must not cost every other workspace its day.
        this.logger.error(
          { err, iterationId: iteration.id, workspaceId: iteration.workspaceId },
          'Failed to snapshot iteration',
        );
      }
    }

    for (const release of activeReleases) {
      const localDate = localDates.get(release.workspaceId);
      if (!localDate) continue;
      // Outside its own window a release has no burnup axis to sit on.
      if (localDate < release.startDate || localDate > release.releaseDate) continue;
      try {
        result.releasesSnapshotted += await this.snapshotRelease(release, localDate);
      } catch (err) {
        result.failures += 1;
        this.logger.error(
          { err, releaseId: release.id, workspaceId: release.workspaceId },
          'Failed to snapshot release burnup',
        );
      }
    }

    for (const [workspaceId, localDate] of localDates) {
      await this.repo.finalizeSnapshotsBefore(workspaceId, localDate);
    }

    return result;
  }

  /**
   * One row per participating Team plus one All Teams row.
   *
   * The All Teams row is measured, not summed: a work item two Teams both touch has to be
   * counted once, and a SUM over the Team rows cannot de-duplicate it (RT §4.1).
   *
   * Both units go on the same row, because `Chart Unit` is a display switch over the same
   * population — storing them separately would let Points and Count disagree about one day.
   */
  private async snapshotRelease(
    release: { id: string; workspaceId: string; projectId: string },
    localDate: string,
  ): Promise<number> {
    const map = await this.preliminaryEstimates.forWorkspace(release.workspaceId);
    const [features, children] = await Promise.all([
      this.repo.getReleaseFeatures(
        release.workspaceId,
        release.projectId,
        (size) => map[size as keyof typeof map]?.points ?? 0,
        (size) => map[size as keyof typeof map]?.count ?? 0,
      ),
      this.repo.getReleaseChildren(release.workspaceId, release.projectId, release.id),
    ]);

    const scopes: Array<{ teamId: string | null }> = [{ teamId: null }];
    for (const teamId of teamsInvolved(children, release.id)) scopes.push({ teamId });

    for (const { teamId } of scopes) {
      const scope = teamId === null ? ALL_TEAMS : ({ kind: 'team', teamId } as const);
      const leaves = trackedLeaves(children, release.id, scope);
      const buckets = bucketFeatures(features, children, release.id, scope);
      const inRelease = [...buckets.direct, ...buckets.derived];
      const points = releaseTotals(leaves, inRelease, 'points');
      const counts = releaseTotals(leaves, inRelease, 'count');

      await this.repo.upsertReleaseSnapshot({
        workspaceId: release.workspaceId,
        releaseId: release.id,
        teamId,
        snapshotDate: localDate,
        acceptedPoints: points.accepted,
        acceptedCount: counts.accepted,
        plannedPoints: points.planned,
        plannedCount: counts.planned,
        preliminaryPoints: preliminaryTotal(inRelease, 'points'),
        preliminaryCount: preliminaryTotal(inRelease, 'count'),
      });
    }

    return scopes.length;
  }
}

/**
 * The Teams that actually have work in this release.
 *
 * Snapshotting every Team in the project would write a row of zeros for Teams that never
 * touched the release, which is indistinguishable from a Team that delivered nothing.
 */
function teamsInvolved(children: readonly ReleaseChild[], releaseId: string): string[] {
  const teams = new Set<string>();
  for (const child of children) {
    if (child.releaseId === releaseId && child.teamId !== null) teams.add(child.teamId);
  }
  return [...teams];
}
