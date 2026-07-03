import type { CursorPayload, PagedResult } from '@platform';
import type {
  IterationStatusMetrics,
  IterationStatusItem,
  IterationStatusFilters,
} from '../iteration-status.types';

export const ITERATION_STATUS_REPOSITORY = Symbol('ITERATION_STATUS_REPOSITORY');

/**
 * Read-model over `work_items` for the Iteration Status screen. All queries are
 * scoped to a single iteration and tenant; nothing here mutates work items.
 */
/** Metrics computed directly from work items (before iteration-derived fields). */
export type RawIterationMetrics = Pick<
  IterationStatusMetrics,
  'totalPlanEstimate' | 'acceptedPoints' | 'defectCount' | 'taskCount'
>;

export interface IIterationStatusRepository {
  /** Aggregate metrics across all non-deleted items assigned to the iteration. */
  getMetrics(iterationId: string, tenantId: string): Promise<RawIterationMetrics>;
  /** Paginated story/defect list assigned to the iteration, with task rollups. */
  listItems(
    iterationId: string,
    tenantId: string,
    filters: IterationStatusFilters,
    args: { limit: number; cursor: CursorPayload | null },
  ): Promise<PagedResult<IterationStatusItem>>;
}
