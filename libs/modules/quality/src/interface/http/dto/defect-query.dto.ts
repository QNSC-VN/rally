import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { PageQuerySchema } from '@platform';

export const DefectQuerySchema = PageQuerySchema.extend({
  projectId: z.string().uuid(),
  search: z.string().max(200).optional(),
  severity: z.enum(['all', 'critical', 'high', 'medium', 'low']).optional().default('all'),
  environment: z
    .enum(['all', 'development', 'staging', 'production', 'testing'])
    .optional()
    .default('all'),
  priority: z.enum(['all', 'none', 'low', 'normal', 'high', 'urgent']).optional().default('all'),
  scheduleState: z
    .enum(['all', 'idea', 'defined', 'ready', 'in_progress', 'completed', 'accepted', 'released'])
    .optional()
    .default('all'),
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
