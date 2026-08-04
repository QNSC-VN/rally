import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { PageQuerySchema } from '@platform';
import {
  defectSeverityEnum,
  defectEnvironmentEnum,
  workItemPriorityEnum,
  workItemScheduleStateEnum,
} from '../../../../../../../db/schema/enums';

// Filter enums are the domain enum values plus the 'all' sentinel, derived from
// the drizzle enums so they can never drift from the database definition.
const ALL = 'all' as const;
const SEVERITY_FILTER = [ALL, ...defectSeverityEnum.enumValues] as const;
const ENVIRONMENT_FILTER = [ALL, ...defectEnvironmentEnum.enumValues] as const;
const PRIORITY_FILTER = [ALL, ...workItemPriorityEnum.enumValues] as const;
const SCHEDULE_STATE_FILTER = [ALL, ...workItemScheduleStateEnum.enumValues] as const;

export const DefectQuerySchema = PageQuerySchema.extend({
  projectId: z.string().uuid(),
  /**
   * Rows to skip — this grid pages by OFFSET, not by the inherited `cursor`.
   *
   * The repository has always taken an offset; the controller simply never forwarded one, so
   * every request returned the first `limit` rows (50 by default) with no way to reach the rest
   * and nothing on screen saying so. Offset rather than the keyset cursor because the footer is a
   * numbered pager over a sortable grid: a reader jumps to a page, and keyset can only step.
   * `cursor` is inherited from `PageQuerySchema` and remains unused here.
   */
  offset: z.coerce.number().int().min(0).optional(),
  search: z.string().max(200).optional(),
  severity: z.enum(SEVERITY_FILTER).optional().default(ALL),
  environment: z.enum(ENVIRONMENT_FILTER).optional().default(ALL),
  priority: z.enum(PRIORITY_FILTER).optional().default(ALL),
  scheduleState: z.enum(SCHEDULE_STATE_FILTER).optional().default(ALL),
  assigneeId: z.string().uuid().optional(),
  releaseId: z.string().uuid().optional(),
  rootCause: z
    .enum(['all', 'requirements', 'design', 'code', 'test', 'integration', 'other'])
    .optional()
    .default('all'),
  resolution: z
    .enum([
      'all',
      'unresolved',
      'fixed',
      'wont_fix',
      'duplicate',
      'cannot_reproduce',
      'deferred',
      'by_design',
    ])
    .optional()
    .default('all'),
  defectState: z
    .enum(['all', 'submitted', 'open', 'fixed', 'closed', 'closed_declined'])
    .optional()
    .default('all'),
});
export class DefectQueryDto extends createZodDto(DefectQuerySchema) {}
