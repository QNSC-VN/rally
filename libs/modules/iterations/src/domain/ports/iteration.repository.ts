import type { CursorPayload, PagedResult } from '@platform';
import type { TeamReadScope } from '../team-read-scope';
import type {
  Iteration,
  IterationOption,
  IterationReference,
  CreateIterationInput,
  UpdateIterationInput,
  IterationFilters,
} from '../iteration.types';

export const ITERATION_REPOSITORY = Symbol('ITERATION_REPOSITORY');

export interface IIterationRepository {
  findById(id: string): Promise<Iteration | null>;
  listByProject(
    projectId: string,
    workspaceId: string,
    filters: IterationFilters,
    args: { limit: number; cursor: CursorPayload | null },
  ): Promise<PagedResult<Iteration>>;
  /** Sum of child task estimate_hours per iteration (IT-001 rollup). */
  taskEstimatesByIteration(
    workspaceId: string,
    iterationIds: string[],
  ): Promise<Map<string, number>>;
  /**
   * ELIGIBILITY. Compact list for the assignment picker: every iteration the WRITE path would
   * accept — same project, and a team-scoped timebox only for that team. Never paginated.
   *
   * NOT filtered by state (P6-VEL-004): an accepted/closed iteration IS a legal assignment target,
   * and withholding it made the move-IN direction of Velocity's "current assignment" rule
   * unreachable through the UI. See the implementation's docblock.
   */
  listAssignmentOptions(
    projectId: string,
    workspaceId: string,
    teamId: string | undefined,
    scope: TeamReadScope,
  ): Promise<IterationOption[]>;
  /**
   * REFERENCE. Every state, plus `team_id` — the projection a filter, an id→name label and
   * `iterationsInScope` need. Since P6-VEL-004 removed the eligibility feed's state predicate the two
   * differ in PROJECTION rather than in population; before that, naming an ACCEPTED iteration was the
   * one thing {@link listAssignmentOptions} structurally could not do, and the reason six SPA call
   * sites read the timebox RECORD instead. Never paginated, same as the eligibility feed.
   */
  listReferences(
    projectId: string,
    workspaceId: string,
    teamId: string | undefined,
    scope: TeamReadScope,
  ): Promise<IterationReference[]>;
  /** Next per-project iteration number (drives the IT-<n> display key). */
  nextKeyNumber(projectId: string, workspaceId: string): Promise<number>;
  create(input: CreateIterationInput): Promise<Iteration>;
  update(id: string, input: UpdateIterationInput): Promise<Iteration>;
  delete(id: string): Promise<void>;
}
