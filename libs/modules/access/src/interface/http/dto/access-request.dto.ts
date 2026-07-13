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

/** Body for project-scoped role assignment — scope is fixed to the URL project. */
export const AssignProjectRoleSchema = z.object({
  userId: z.string().uuid(),
  roleId: z.string().uuid(),
});
export class AssignProjectRoleDto extends createZodDto(AssignProjectRoleSchema) {}
