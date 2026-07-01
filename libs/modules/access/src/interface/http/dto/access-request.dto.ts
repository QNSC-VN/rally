import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { scopeTypeEnum } from '../../../../../../../db/schema/enums';

export const AssignRoleSchema = z.object({
  userId: z.string().uuid(),
  roleId: z.string().uuid(),
  scopeType: z.enum(scopeTypeEnum.enumValues),
  scopeId: z.string().uuid().optional(),
});
export class AssignRoleDto extends createZodDto(AssignRoleSchema) {}
