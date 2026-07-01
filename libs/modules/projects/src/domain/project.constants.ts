import type { WorkflowStatusCategory } from '../../../../../db/schema/enums';

/**
 * Default workflow statuses seeded for every new project.
 * Mirrors the standard Rally flow: Defined → In Progress → Completed → Accepted.
 * Extracted as a named constant so tests and seeding scripts share the same
 * definition — no risk of the service and the seed diverging.
 */
export interface DefaultStatusSeed {
  name: string;
  category: WorkflowStatusCategory;
  color: string;
  position: number;
  isDefault: boolean;
}

export const DEFAULT_WORKFLOW_STATUSES: readonly DefaultStatusSeed[] = [
  { name: 'Defined', category: 'to_do', color: '#6B7280', position: 0, isDefault: true },
  { name: 'In Progress', category: 'in_progress', color: '#3B82F6', position: 1, isDefault: false },
  { name: 'Completed', category: 'done', color: '#10B981', position: 2, isDefault: false },
  { name: 'Accepted', category: 'done', color: '#059669', position: 3, isDefault: false },
] as const;
