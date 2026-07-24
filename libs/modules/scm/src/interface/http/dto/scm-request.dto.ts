import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

export const CreateScmRepositorySchema = z.object({
  provider: z.enum(['github', 'ghe']),
  /** owner/name, e.g. "DT-SFI/dt". */
  fullName: z.string().trim().min(1).max(255),
  baseUrl: z.string().url().max(512).nullable().optional(),
  /** Projects whose work-item keys this repo may reference (≥1). */
  projectIds: z.array(z.string().uuid()).min(1),
});
export class CreateScmRepositoryDto extends createZodDto(CreateScmRepositorySchema) {}
