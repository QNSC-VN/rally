import type { StoredSnapshot } from '../burndown';
import type { ReleaseChild, ReleaseFeature, StoredBurnupRow } from '../release-tracking';
import type { TeamScope } from '../report-scope';
import type { CapacityRecord, ScopedTaskHours } from '../team-capacity';
import type { VelocityItem } from '../velocity';

export const REPORTING_REPOSITORY = Symbol('REPORTING_REPOSITORY');

/** `workspace_settings` rows every report's date handling depends on. */
export interface WorkspaceReportSettings {
  timeZone: string;
  /** ISO day numbers, 1 = Mon … 7 = Sun. */
  workingDays: number[];
}

export interface IterationRow {
  id: string;
  projectId: string;
  teamId: string | null;
  timeboxGroupId: string | null;
  name: string;
  startDate: string | null;
  endDate: string | null;
  totalTaskEstimateAtStart: number | null;
}

/** One shared timebox, with the per-Team iterations it fuses. */
export interface TimeboxGroup {
  timeboxGroupId: string | null;
  name: string;
  startDate: string | null;
  endDate: string | null;
  iterationIds: string[];
}

export interface ReleaseRow {
  id: string;
  workspaceId: string;
  projectId: string;
  name: string;
  startDate: string | null;
  releaseDate: string | null;
  idealTargetPoints: number | null;
  idealTargetCount: number | null;
}

/** An iteration the daily job is currently snapshotting. */
export interface ActiveIterationRow extends IterationRow {
  workspaceId: string;
}

export interface ActiveReleaseRow {
  id: string;
  workspaceId: string;
  projectId: string;
  startDate: string;
  releaseDate: string;
}

export interface IterationSnapshotWrite {
  workspaceId: string;
  iterationId: string;
  /** Workspace-local date. */
  snapshotDate: string;
  remainingTodo: number;
  acceptedPoints: number;
}

export interface ReleaseSnapshotWrite {
  workspaceId: string;
  releaseId: string;
  /** Null = the All Teams aggregate row. */
  teamId: string | null;
  snapshotDate: string;
  acceptedPoints: number;
  acceptedCount: number;
  plannedPoints: number;
  plannedCount: number;
  preliminaryPoints: number;
  preliminaryCount: number;
}

/**
 * The reads Phase 6 needs, plus the two snapshot writes the daily job makes. Deliberately
 * narrow: each method answers one report's question and returns rows the pure domain modules
 * already accept, so the service is assembly and the SQL has no arithmetic in it.
 */
export interface IReportingRepository {
  // ── shared ────────────────────────────────────────────────────────────────
  getWorkspaceSettings(workspaceId: string): Promise<WorkspaceReportSettings>;
  getProjectName(workspaceId: string, projectId: string): Promise<string | null>;
  getTeamName(workspaceId: string, teamId: string): Promise<string | null>;
  findIteration(workspaceId: string, iterationId: string): Promise<IterationRow | null>;
  /**
   * Every iteration sharing one timebox group inside a project, narrowed to the scope.
   * For a selected Team this is at most that Team's own iteration.
   */
  findTimeboxSiblings(
    workspaceId: string,
    projectId: string,
    timeboxGroupId: string | null,
    scope: TeamScope,
    fallbackIterationId: string,
  ): Promise<IterationRow[]>;

  // ── Iteration Burndown ────────────────────────────────────────────────────
  getIterationSnapshots(workspaceId: string, iterationIds: string[]): Promise<StoredSnapshot[]>;
  countScheduledWork(workspaceId: string, iterationIds: string[]): Promise<number>;

  // ── Velocity ──────────────────────────────────────────────────────────────
  /**
   * Timeboxes eligible for Velocity: local end date already past, and at least one
   * Story/Defect currently assigned. Ordered by end date ascending.
   */
  findEligibleTimeboxes(
    workspaceId: string,
    projectId: string,
    scope: TeamScope,
    todayLocalDate: string,
  ): Promise<TimeboxGroup[]>;
  /** Currently-assigned Story/Defect rows for a set of iterations, keyed by iteration. */
  getVelocityItems(
    workspaceId: string,
    iterationIds: string[],
  ): Promise<Array<VelocityItem & { iterationId: string }>>;

  // ── Team Capacity ─────────────────────────────────────────────────────────
  getCapacityRecords(
    workspaceId: string,
    projectId: string,
    iterationIds: string[],
    scope: TeamScope,
  ): Promise<CapacityRecord[]>;
  getScopedTaskHours(
    workspaceId: string,
    projectId: string,
    iterationIds: string[],
    scope: TeamScope,
  ): Promise<ScopedTaskHours[]>;

  // ── Release Tracking ──────────────────────────────────────────────────────
  findRelease(workspaceId: string, releaseId: string): Promise<ReleaseRow | null>;
  /**
   * Every non-archived Feature in the project, with its estimate tiers resolved.
   *
   * `state` rides along for the row's State column. It is not part of any classification
   * rule — RT §3 is explicit that membership is read from `releaseId`, never from progress.
   */
  getReleaseFeatures(
    workspaceId: string,
    projectId: string,
    preliminaryPoints: (size: string) => number,
    preliminaryCount: (size: string) => number,
  ): Promise<Array<ReleaseFeature & { state: string }>>;
  /**
   * Story/Defect rows relevant to one release: assigned to it, OR a child of any Feature in
   * the project (a Direct Feature's Status counts children in other releases too).
   */
  getReleaseChildren(
    workspaceId: string,
    projectId: string,
    releaseId: string,
  ): Promise<ReleaseChild[]>;
  getReleaseBurnupRows(
    workspaceId: string,
    releaseId: string,
    scope: TeamScope,
    unit: 'points' | 'count',
  ): Promise<StoredBurnupRow[]>;
  /** Iterations overlapping the release window, for the chart's secondary band. */
  findIterationsInWindow(
    workspaceId: string,
    projectId: string,
    scope: TeamScope,
    startDate: string,
    endDate: string,
  ): Promise<IterationRow[]>;

  // ── the daily snapshot job ────────────────────────────────────────────────
  //
  // Writes, and the only writes in this module. They exist here rather than in a second
  // repository because they measure the same populations the reads serve, and two classes
  // would let the stored history and the live query drift apart.

  /** Every committed iteration across every workspace. Cron work has no actor. */
  findActiveIterations(): Promise<ActiveIterationRow[]>;
  /** Releases whose window is open, across every workspace. */
  findActiveReleases(): Promise<ActiveReleaseRow[]>;

  /**
   * SUM(task.estimate) over the tasks in an iteration's scope, for the one-time Ideal
   * baseline capture (IB-BR-03).
   */
  sumTaskEstimate(workspaceId: string, iterationId: string): Promise<number>;
  /** Stores the baseline once. A second call must not overwrite an existing capture. */
  captureStartBaseline(
    workspaceId: string,
    iterationId: string,
    totalTaskEstimate: number,
    at: Date,
  ): Promise<void>;

  /**
   * Stores the release's Ideal target once, from the planned scope on its FIRST snapshot day.
   *
   * The same capture-once rule as the iteration baseline, for the same reason (RT-BR-09): the
   * Ideal must not be reconstructed from today's mutable Planned value, or every past day's
   * trajectory silently redraws whenever scope changes. `ideal_target_points` /
   * `ideal_target_count` had no writer anywhere in the codebase before this, so the Ideal line
   * could never be drawn at all.
   *
   * Points and count move together: `Chart Unit` is a display switch over one population, so a
   * release with a target in one unit and not the other would draw an Ideal on one toggle
   * setting and not the other.
   */
  captureReleaseIdealTarget(
    workspaceId: string,
    releaseId: string,
    plannedPoints: number,
    plannedCount: number,
  ): Promise<void>;

  /**
   * Today's measured values for one iteration: SUM(task.todo) in hours, and the cumulative
   * accepted points as of the end of the workspace-local day.
   */
  measureIterationDay(
    workspaceId: string,
    iterationId: string,
    endOfDay: Date,
  ): Promise<{ remainingTodo: number; acceptedPoints: number }>;

  upsertIterationSnapshot(row: IterationSnapshotWrite): Promise<void>;
  upsertReleaseSnapshot(row: ReleaseSnapshotWrite): Promise<void>;

  /**
   * Freeze every snapshot for a closed local day.
   *
   * The job only ever WRITES today's date, so a past date is already immutable in practice;
   * this flag records that fact so a reader (or an operator running a correction) can tell a
   * finished day from one still being written.
   */
  finalizeSnapshotsBefore(workspaceId: string, localDate: string): Promise<void>;
}
