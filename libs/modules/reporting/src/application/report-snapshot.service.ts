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

      /**
       * Only inside the iteration's own window — the guard the release loop below already has.
       *
       * `findActiveIterations` selects on `state = 'committed'` and nothing else, and committing early
       * is legal (`IterationsService` checks only that the current state is `planning`). So an
       * iteration committed before it starts had its IMMUTABLE baseline captured at commit time —
       * commonly zero, because tasks are broken down after commitment — and `captureStartBaseline`'s
       * `IS NULL` guard then made that permanent.
       *
       * A captured `0` is the dangerous part: it is not null, so it passes every "no baseline" check.
       * `idealLine(0, N)` returns all zeros, the client's `noBaseline` note stays hidden, a flat zero
       * line is drawn as a measured plan, and the status indicator pins to "Behind plan" for the whole
       * sprint. The same loop also wrote daily rows for dates entirely outside the window.
       *
       * IB §4: capture the baseline "when the Iteration starts".
       */
      if (
        (iteration.startDate && localDate < iteration.startDate) ||
        (iteration.endDate && localDate > iteration.endDate)
      ) {
        continue;
      }

      try {
        /**
         * The Ideal baseline, ONE ROW PER TEAM, captured on the first tick inside the window.
         *
         * IB §4 makes the baseline per team and All Teams the sum of the participating team baselines,
         * so this is grouped by the resolved team rather than being a single iteration-wide number.
         * `captureTeamBaselines` uses `onConflictDoNothing`, so a later tick adds nothing and the line
         * cannot move when tasks are added or re-estimated — the same guarantee the old `IS NULL`
         * predicate gave, now expressible per scope.
         *
         * Attempted on every in-window tick rather than gated on a column: a team that had no work on
         * the iteration's first day acquires its own baseline the first time it does, which is the
         * closest thing to "at Iteration start" that exists for that team.
         */
        const perTeam = await this.repo.sumTaskEstimateByTeam(iteration.workspaceId, iteration.id);
        if (perTeam.length > 0) {
          await this.repo.captureTeamBaselines(iteration.workspaceId, iteration.id, perTeam, now);
          result.baselinesCaptured += 1;
        }

        /**
         * One row per SCOPE: All Teams, then each team with work in the iteration.
         *
         * Burndown is frozen history, so a team-scoped chart cannot be recomputed on read — the
         * grain has to carry the team or the report simply cannot be served, which is what used to
         * happen for the shared, team-less iterations that make up almost all of them. Each scope
         * is MEASURED independently; the All Teams row is never the sum of the team rows, because
         * a task two teams both touch would then be counted twice.
         */
        const endOfDay = endOfWorkspaceDay(localDate, timeZone);
        const teamIds = await this.repo.teamsInIterationScope(iteration.workspaceId, iteration.id);
        for (const teamId of [null, ...teamIds]) {
          const measured = await this.repo.measureIterationDay(
            iteration.workspaceId,
            iteration.id,
            endOfDay,
            teamId,
          );
          await this.repo.upsertIterationSnapshot({
            workspaceId: iteration.workspaceId,
            iterationId: iteration.id,
            teamId,
            snapshotDate: localDate,
            ...measured,
          });
        }
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
        result.releasesSnapshotted += await this.snapshotRelease(release, localDate, now);
      } catch (err) {
        result.failures += 1;
        this.logger.error(
          { err, releaseId: release.id, workspaceId: release.workspaceId },
          'Failed to snapshot release burnup',
        );
      }
    }

    /**
     * Finalize over every workspace with an OPEN snapshot, not just the ones that are busy today.
     *
     * `localDates` only holds workspaces with an active iteration or release — the set the snapshot
     * loop above needed. Running the finalization pass over that same map meant the final day of a
     * workspace's last timebox never got frozen: nothing was active any more, so the workspace never
     * reappeared. Those days stayed `finalized = false` indefinitely, which is the flag a reader (or
     * an operator running a correction) uses to tell a finished day from one still being written.
     *
     * Timezones are resolved lazily here because most of these workspaces are already in the map; only
     * the newly-quiet ones cost an extra settings read.
     */
    for (const workspaceId of await this.repo.findWorkspacesWithOpenSnapshots()) {
      let localDate = localDates.get(workspaceId);
      if (!localDate) {
        const settings = await this.repo.getWorkspaceSettings(workspaceId);
        localDate = workspaceLocalDate(now, settings.timeZone);
      }
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
    now: Date,
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

      /**
       * The Ideal target for THIS scope, captured once.
       *
       * It used to be captured only under All Teams, from two columns on `releases` — so every team's
       * burnup drew its own Accepted line against the WHOLE release's target and each team looked
       * permanently behind, while `getReleaseBurnupRows` correctly narrowed the measured series to that
       * team's rows. RT §7's acceptance example 7 recomputes the entire Burnup from the selected Team's
       * scope, and the Ideal is part of that definition.
       *
       * Already inside the `scopes` loop, so the planned totals in hand are this scope's — and the All
       * Teams row is MEASURED here, the same population `upsertReleaseSnapshot` records below, which is
       * why `findReleaseTeamTarget` reads it instead of summing the team rows. First snapshot day per
       * scope, because `captureReleaseTeamTarget` uses `onConflictDoNothing` and RT-BR-09 forbids
       * deriving the Ideal from today's mutable Planned value.
       */
      await this.repo.captureReleaseTeamTarget({
        workspaceId: release.workspaceId,
        releaseId: release.id,
        teamId,
        plannedPoints: points.planned,
        plannedCount: counts.planned,
        at: now,
      });

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
