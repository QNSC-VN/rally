import { Inject, Injectable } from '@nestjs/common';
import { NotFoundException } from '@platform';
import type { JwtPayload } from '@platform';
import { PreliminaryEstimateMapService } from '@modules/portfolio';
import { IReportingRepository, REPORTING_REPOSITORY } from '../domain/ports/reporting.repository';
import type { IterationRow } from '../domain/ports/reporting.repository';
import { buildBurndownSeries, combineBaselines, combineTeamSnapshots } from '../domain/burndown';
import {
  bucketFeatures,
  buildBurnup,
  derivedStatus,
  directStatus,
  featureProgress,
  isFullMismatch,
  releaseMismatches,
  releaseTotals,
  trackedLeaves,
  unparentedItems,
  type ChartUnit,
  type ReleaseBucket,
  type ReleaseChild,
  type ReleaseFeature,
} from '../domain/release-tracking';
import { endOfWorkspaceDay, teamScope, workspaceLocalDate } from '../domain/report-scope';
import { describeEmptiness, rollUpTeamCapacity } from '../domain/team-capacity';
import {
  DEFAULT_VELOCITY_WINDOW,
  buildBar,
  computeAverages,
  selectWindow,
  type VelocityWindow,
} from '../domain/velocity';
import type {
  IterationBurndownReport,
  ReleaseBurnupReport,
  ReleaseTrackingReport,
  ReleaseTrackingRow,
  ReportContext,
  ReportTimebox,
  TeamCapacityReport,
  VelocityReport,
} from '../domain/reporting.types';

/** What every report calls the scope when no Team is selected (IB §7's context title). */
const ALL_TEAMS_LABEL = 'All Teams';

interface ScopeArgs {
  projectId: string;
  teamId?: string | null;
}

/**
 * Assembly only. Every rule lives in `domain/`; this service resolves scope, asks the
 * repository for rows and hands them to the pure functions.
 *
 * The Project half of authorization is the PolicyGuard's (`report:view` on every route).
 * The Team half is enforced by construction: a selected Team is pushed into each query's
 * WHERE clause rather than filtered afterwards, because "hiding rows in the browser is not
 * sufficient authorization" (§5.2) applies just as much to hiding them in the service.
 */
@Injectable()
export class ReportingService {
  constructor(
    @Inject(REPORTING_REPOSITORY) private readonly repo: IReportingRepository,
    private readonly preliminaryEstimates: PreliminaryEstimateMapService,
  ) {}

  // ── Iteration Burndown ────────────────────────────────────────────────────

  async getIterationBurndown(
    actor: JwtPayload,
    args: ScopeArgs & { iterationId: string },
  ): Promise<IterationBurndownReport> {
    const { workspaceId } = actor;
    const scope = teamScope(args.teamId);
    const settings = await this.repo.getWorkspaceSettings(workspaceId);
    const selected = await this.requireIteration(workspaceId, args);

    // For All Teams this is every Team's iteration for the shared timebox; for a selected
    // Team it is that Team's alone. An empty result means the Team has no iteration in this
    // timebox — returning the other Teams' data would leak across the scope.
    const participating = await this.repo.findTimeboxSiblings(
      workspaceId,
      args.projectId,
      selected.timeboxGroupId,
      scope,
      selected.id,
    );
    const iterationIds = participating.map((i) => i.id);

    const [snapshots, scheduled] = await Promise.all([
      this.repo.getIterationSnapshots(workspaceId, iterationIds),
      this.repo.countScheduledWork(workspaceId, iterationIds),
    ]);

    const timebox = this.toTimebox(selected, participating);
    const series = buildBurndownSeries({
      startDate: timebox.startDate ?? '',
      endDate: timebox.endDate ?? '',
      workingDays: settings.workingDays,
      // "For All Teams, the baseline is the sum of the participating Team baselines."
      totalTaskEstimateAtStart: combineBaselines(
        participating.map((i) => i.totalTaskEstimateAtStart),
      ),
      snapshots: combineTeamSnapshots(snapshots),
    });

    return {
      context: await this.context(actor, args, settings.timeZone),
      timebox,
      points: series.points,
      totalTaskEstimateAtStart: series.totalTaskEstimateAtStart,
      historyState: series.historyState,
      status: series.status,
      latestSnapshotDate: series.latestSnapshotDate,
      // Distinguishes "no scheduled work" from "work exists, the job has not run" (IB §7).
      hasScheduledWork: scheduled > 0,
    };
  }

  // ── Velocity ──────────────────────────────────────────────────────────────

  async getVelocity(
    actor: JwtPayload,
    args: ScopeArgs & { window?: VelocityWindow },
  ): Promise<VelocityReport> {
    const { workspaceId } = actor;
    const scope = teamScope(args.teamId);
    const settings = await this.repo.getWorkspaceSettings(workspaceId);
    const window = args.window ?? DEFAULT_VELOCITY_WINDOW;

    // "its Workspace-local end date is before today" — today in the WORKSPACE's calendar,
    // not the server's, or a workspace east of UTC sees its just-closed iteration a day late.
    const today = workspaceLocalDate(new Date(), settings.timeZone);
    const eligible = await this.repo.findEligibleTimeboxes(
      workspaceId,
      args.projectId,
      scope,
      today,
    );
    const windowed = selectWindow(eligible, window);

    const items = await this.repo.getVelocityItems(
      workspaceId,
      windowed.flatMap((t) => t.iterationIds),
    );
    const byIteration = new Map<string, typeof items>();
    for (const item of items) {
      const list = byIteration.get(item.iterationId);
      if (list) list.push(item);
      else byIteration.set(item.iterationId, [item]);
    }

    const bars = windowed.map((timebox) =>
      buildBar({
        timeboxKey: timebox.timeboxGroupId ?? timebox.iterationIds[0],
        name: timebox.name,
        startDate: timebox.startDate,
        endDate: timebox.endDate,
        // The boundary is the END of the timebox's last LOCAL day: an item accepted at 22:00
        // on the final evening is During, one accepted after local midnight is After.
        endBoundary: endOfWorkspaceDay(timebox.endDate ?? today, settings.timeZone),
        iterationCount: timebox.iterationIds.length,
        items: timebox.iterationIds.flatMap((id) => byIteration.get(id) ?? []),
      }),
    );

    return {
      context: await this.context(actor, args, settings.timeZone),
      window,
      bars,
      averages: computeAverages(bars),
      unclassifiedItems: bars.reduce((sum, b) => sum + b.unclassifiedItems, 0),
    };
  }

  // ── Team Capacity ─────────────────────────────────────────────────────────

  async getTeamCapacity(
    actor: JwtPayload,
    args: ScopeArgs & { iterationId: string },
  ): Promise<TeamCapacityReport> {
    const { workspaceId } = actor;
    const scope = teamScope(args.teamId);
    const settings = await this.repo.getWorkspaceSettings(workspaceId);
    const selected = await this.requireIteration(workspaceId, args);

    const participating = await this.repo.findTimeboxSiblings(
      workspaceId,
      args.projectId,
      selected.timeboxGroupId,
      scope,
      selected.id,
    );
    const iterationIds = participating.map((i) => i.id);

    const [capacities, taskHours] = await Promise.all([
      this.repo.getCapacityRecords(workspaceId, args.projectId, iterationIds, scope),
      this.repo.getScopedTaskHours(workspaceId, args.projectId, iterationIds, scope),
    ]);

    const rollup = rollUpTeamCapacity({ capacities, tasks: taskHours });

    return {
      context: await this.context(actor, args, settings.timeZone),
      timebox: this.toTimebox(selected, participating),
      totals: rollup.totals,
      teams: rollup.teams,
      ...describeEmptiness(rollup),
    };
  }

  // ── Release Tracking ──────────────────────────────────────────────────────

  async getReleaseTracking(
    actor: JwtPayload,
    args: ScopeArgs & { releaseId: string; unit?: ChartUnit; bucket?: ReleaseBucket },
  ): Promise<ReleaseTrackingReport> {
    const { workspaceId } = actor;
    const scope = teamScope(args.teamId);
    const unit: ChartUnit = args.unit ?? 'points';
    const bucket: ReleaseBucket = args.bucket ?? 'direct';
    const settings = await this.repo.getWorkspaceSettings(workspaceId);

    const release = await this.repo.findRelease(workspaceId, args.releaseId);
    if (!release || release.projectId !== args.projectId) {
      throw new NotFoundException('RELEASE_NOT_FOUND', 'Release not found');
    }

    const map = await this.preliminaryEstimates.forWorkspace(workspaceId);
    const [features, children] = await Promise.all([
      this.repo.getReleaseFeatures(
        workspaceId,
        args.projectId,
        (size) => map[size as keyof typeof map]?.points ?? 0,
        (size) => map[size as keyof typeof map]?.count ?? 0,
      ),
      this.repo.getReleaseChildren(workspaceId, args.projectId, release.id),
    ]);

    const childrenByFeature = new Map<string, ReleaseChild[]>();
    for (const child of children) {
      if (child.featureId === null) continue;
      const list = childrenByFeature.get(child.featureId);
      if (list) list.push(child);
      else childrenByFeature.set(child.featureId, [child]);
    }

    const buckets = bucketFeatures(features, children, release.id, scope);
    const unparented = unparentedItems(children, release.id, scope);
    const leaves = trackedLeaves(children, release.id, scope);

    const rows =
      bucket === 'direct'
        ? buckets.direct.map((f, i) =>
            this.directRow(f, i, childrenByFeature.get(f.id) ?? [], release.id, unit),
          )
        : bucket === 'derived'
          ? buckets.derived.map((f, i) =>
              this.derivedRow(f, i, buckets.derivedCause.get(f.id) ?? [], unit),
            )
          : unparented.map((c, i) => this.unparentedRow(c, i, unit));

    return {
      context: await this.context(actor, args, settings.timeZone),
      release: {
        id: release.id,
        name: release.name,
        startDate: release.startDate,
        releaseDate: release.releaseDate,
      },
      unit,
      bucket,
      // All three stay visible even when the active bucket is empty (§5.1).
      summary: {
        direct: buckets.direct.length,
        derived: buckets.derived.length,
        unparented: unparented.length,
      },
      rows,
      // Preliminary sums the Direct and Derived Features; Planned/Accepted use the tracked
      // leaves. Three totals, one population each, exactly as RT §4 splits them.
      totals: releaseTotals(leaves, [...buckets.direct, ...buckets.derived], unit),
    };
  }

  async getReleaseBurnup(
    actor: JwtPayload,
    args: ScopeArgs & { releaseId: string; unit?: ChartUnit },
  ): Promise<ReleaseBurnupReport> {
    const { workspaceId } = actor;
    const scope = teamScope(args.teamId);
    const unit: ChartUnit = args.unit ?? 'points';

    const release = await this.repo.findRelease(workspaceId, args.releaseId);
    if (!release || release.projectId !== args.projectId) {
      throw new NotFoundException('RELEASE_NOT_FOUND', 'Release not found');
    }

    // No window means no axis and no ideal trajectory. Reported as unavailable rather than
    // drawn from whichever snapshots happen to exist.
    if (!release.startDate || !release.releaseDate) {
      return { unit, points: [], historyState: 'no-window', idealTarget: null, iterations: [] };
    }

    const [snapshots, band] = await Promise.all([
      this.repo.getReleaseBurnupRows(workspaceId, release.id, scope, unit),
      this.repo.findIterationsInWindow(
        workspaceId,
        args.projectId,
        scope,
        release.startDate,
        release.releaseDate,
      ),
    ]);

    const { points, historyState, idealTarget } = buildBurnup({
      axis: calendarDays(release.startDate, release.releaseDate),
      idealTarget: unit === 'points' ? release.idealTargetPoints : release.idealTargetCount,
      snapshots,
    });

    return {
      unit,
      points,
      historyState,
      idealTarget,
      iterations: band.map((i) => ({
        id: i.id,
        name: i.name,
        startDate: i.startDate,
        endDate: i.endDate,
      })),
    };
  }

  // ── internals ─────────────────────────────────────────────────────────────

  private async requireIteration(
    workspaceId: string,
    args: ScopeArgs & { iterationId: string },
  ): Promise<IterationRow> {
    const selected = await this.repo.findIteration(workspaceId, args.iterationId);
    // The project check is not redundant with the guard: `report:view` is enforced against
    // the projectId in the query string, so an iteration id from another project would
    // otherwise be read under a project the caller legitimately holds.
    if (!selected || selected.projectId !== args.projectId) {
      throw new NotFoundException('ITERATION_NOT_FOUND', 'Iteration not found');
    }
    return selected;
  }

  /** Direct rows: Status over EVERY child, plus the mismatch issues (RT-BR-05, §5). */
  private directRow(
    feature: ReleaseFeature & { state: string },
    index: number,
    allChildren: ReleaseChild[],
    releaseId: string,
    unit: ChartUnit,
  ): ReleaseTrackingRow {
    return {
      rank: index + 1,
      id: feature.id,
      itemKey: feature.itemKey,
      name: feature.name,
      teams: [{ id: feature.teamId, name: feature.teamName ?? '—' }],
      issueType: 'feature',
      state: feature.state,
      childCount: allChildren.length,
      status: directStatus(allChildren, unit),
      mismatches: releaseMismatches(allChildren, releaseId),
      fullMismatch: isFullMismatch(allChildren, releaseId),
      plannedStartDate: feature.plannedStartDate,
      plannedEndDate: feature.plannedEndDate,
      progress: featureProgress(allChildren),
    };
  }

  /**
   * Derived rows: Status over the causing children only, no percentage, and a Team column
   * showing the scoped child Teams that caused inclusion rather than the Feature's own Team.
   */
  private derivedRow(
    feature: ReleaseFeature & { state: string },
    index: number,
    cause: ReleaseChild[],
    unit: ChartUnit,
  ): ReleaseTrackingRow {
    const teams = new Map<string | null, string>();
    for (const child of cause) teams.set(child.teamId, child.teamName ?? '—');
    return {
      rank: index + 1,
      id: feature.id,
      itemKey: feature.itemKey,
      name: feature.name,
      teams: [...teams].map(([id, name]) => ({ id, name })),
      issueType: 'feature',
      state: feature.state,
      childCount: cause.length,
      status: derivedStatus(cause, unit),
      // A Derived Feature is included BECAUSE of a child in this release; its children
      // elsewhere are the reason it is derived, not a contradiction to warn about.
      mismatches: [],
      fullMismatch: false,
      plannedStartDate: feature.plannedStartDate,
      plannedEndDate: feature.plannedEndDate,
      progress: null,
    };
  }

  private unparentedRow(child: ReleaseChild, index: number, unit: ChartUnit): ReleaseTrackingRow {
    return {
      rank: index + 1,
      id: child.id,
      itemKey: child.itemKey,
      name: child.title,
      teams: [{ id: child.teamId, name: child.teamName ?? '—' }],
      issueType: child.type,
      state: child.scheduleState,
      childCount: 0,
      // An Unparented item IS the leaf, so its own acceptance is the whole status.
      status: directStatus([child], unit),
      mismatches: [],
      fullMismatch: false,
      plannedStartDate: null,
      plannedEndDate: null,
      progress: null,
    };
  }

  private toTimebox(selected: IterationRow, participating: IterationRow[]): ReportTimebox {
    const starts = participating.map((i) => i.startDate).filter((d): d is string => d !== null);
    const ends = participating.map((i) => i.endDate).filter((d): d is string => d !== null);
    return {
      iterationId: selected.id,
      timeboxGroupId: selected.timeboxGroupId,
      name: selected.name,
      // The union of the participating windows. Teams sharing a timebox normally carry
      // identical dates; taking the union means a Team that shifted one end by a day still
      // has its last day plotted rather than silently clipped.
      startDate: starts.length ? starts.reduce((a, b) => (a < b ? a : b)) : selected.startDate,
      endDate: ends.length ? ends.reduce((a, b) => (a > b ? a : b)) : selected.endDate,
      iterationCount: participating.length,
    };
  }

  private async context(
    actor: JwtPayload,
    args: ScopeArgs,
    timeZone: string,
  ): Promise<ReportContext> {
    const [projectName, teamName] = await Promise.all([
      this.repo.getProjectName(actor.workspaceId, args.projectId),
      args.teamId ? this.repo.getTeamName(actor.workspaceId, args.teamId) : Promise.resolve(null),
    ]);
    if (projectName === null) {
      throw new NotFoundException('PROJECT_NOT_FOUND', 'Project not found');
    }
    return {
      projectId: args.projectId,
      projectName,
      teamId: args.teamId ?? null,
      // The centred context title is `{Project} - {Team|All Teams}` (IB §7), so the label for
      // "no Team selected" belongs to the contract rather than to the SPA.
      teamName: args.teamId ? (teamName ?? ALL_TEAMS_LABEL) : ALL_TEAMS_LABEL,
      timeZone,
    };
  }
}

/** Every calendar date from start to end inclusive — the burnup axis. */
function calendarDays(start: string, end: string): string[] {
  const out: string[] = [];
  const cursor = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);
  while (cursor.getTime() <= last.getTime()) {
    out.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}
