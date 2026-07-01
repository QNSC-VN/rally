import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const RoleResponseSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid().nullable(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  isSystem: z.boolean(),
  permissions: z.array(z.string()),
  createdAt: z.string().datetime(),
});

export class RoleResponseDto extends createZodDto(RoleResponseSchema) {}

export const RoleAssignmentResponseSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  userId: z.string().uuid(),
  roleId: z.string().uuid(),
  scopeType: z.string(),
  scopeId: z.string().uuid().nullable(),
  grantedBy: z.string().uuid().nullable(),
  createdAt: z.string().datetime(),
});

export class RoleAssignmentResponseDto extends createZodDto(RoleAssignmentResponseSchema) {}
