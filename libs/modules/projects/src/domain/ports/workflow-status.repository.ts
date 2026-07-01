import type {
  WorkflowStatus,
  WorkflowTransition,
  CreateWorkflowStatusInput,
  CreateWorkflowTransitionInput,
} from '../project.types';
import type { DbExecutor } from '@platform';

export const WORKFLOW_STATUS_REPOSITORY = Symbol('WORKFLOW_STATUS_REPOSITORY');

export interface IWorkflowStatusRepository {
  findById(id: string): Promise<WorkflowStatus | null>;
  listByProject(projectId: string): Promise<WorkflowStatus[]>;
  create(input: CreateWorkflowStatusInput, tx?: DbExecutor): Promise<WorkflowStatus>;
  updatePositions(projectId: string, orderedIds: string[]): Promise<void>;
  delete(id: string): Promise<void>;
  findDefault(projectId: string): Promise<WorkflowStatus | null>;
  canTransition(projectId: string, fromStatusId: string, toStatusId: string): Promise<boolean>;
  listTransitions(projectId: string): Promise<WorkflowTransition[]>;
  findTransitionById(id: string): Promise<WorkflowTransition | null>;
  createTransition(input: CreateWorkflowTransitionInput): Promise<WorkflowTransition>;
  deleteTransition(id: string): Promise<void>;
}
