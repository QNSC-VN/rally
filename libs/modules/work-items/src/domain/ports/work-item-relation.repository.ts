import type {
  WorkItemRelation,
  WorkItemRelationView,
  CreateWorkItemRelationInput,
} from '../work-item-relation.types';
import type { WorkItemRelationType } from '../../../../../../db/schema/enums';
import type { DbExecutor } from '@platform';

export const WORK_ITEM_RELATION_REPOSITORY = Symbol('WORK_ITEM_RELATION_REPOSITORY');

export interface IWorkItemRelationRepository {
  /** All relations touching `itemId` (as source or target), resolved for display. */
  listForItem(itemId: string, workspaceId: string): Promise<WorkItemRelationView[]>;

  /** Whether the exact (source, target, type) triple already exists. */
  exists(
    sourceItemId: string,
    targetItemId: string,
    relationType: WorkItemRelationType,
    workspaceId: string,
  ): Promise<boolean>;

  /** `tx` enlists the insert in the caller's unit of work, alongside its activity entry. */
  create(
    input: CreateWorkItemRelationInput,
    workspaceId: string,
    tx?: DbExecutor,
  ): Promise<WorkItemRelation>;

  findById(id: string, workspaceId: string): Promise<WorkItemRelation | null>;

  delete(id: string, workspaceId: string, tx?: DbExecutor): Promise<void>;

  /** Delete every relation touching `itemId` (either end) — used on item delete. */
  deleteForItem(itemId: string, workspaceId: string): Promise<void>;

  /**
   * Returns true if `targetId` can already reach `sourceId` by following edges
   * of the given relation type in the canonical (source → target) direction.
   * Adding source → target would then close a cycle. Used only for the acyclic
   * relation types (blocks, depends_on).
   */
  wouldCreateCycle(
    sourceId: string,
    targetId: string,
    relationType: WorkItemRelationType,
    workspaceId: string,
  ): Promise<boolean>;
}
