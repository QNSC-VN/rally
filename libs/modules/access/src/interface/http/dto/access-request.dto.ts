import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { PERMISSION } from '@shared-kernel';
import { scopeTypeEnum } from '../../../../../../../db/schema/enums';

export const AssignRoleSchema = z.object({
  userId: z.string().uuid(),
  roleId: z.string().uuid(),
  scopeType: z.enum(scopeTypeEnum.enumValues),
  scopeId: z.string().uuid().optional(),
});
export class AssignRoleDto extends createZodDto(AssignRoleSchema) {}

/** Body for editing a custom role's permission set (workspace admin only). */
export const UpdateRolePermissionsSchema = z.object({
  permissions: z.array(z.nativeEnum(PERMISSION)).max(100),
});
export class UpdateRolePermissionsDto extends createZodDto(UpdateRolePermissionsSchema) {}

/** Body for project-scoped role assignment — scope is fixed to the URL project. */
export const AssignProjectRoleSchema = z.object({
  userId: z.string().uuid(),
  roleId: z.string().uuid(),
});
export class AssignProjectRoleDto extends createZodDto(AssignProjectRoleSchema) {}
