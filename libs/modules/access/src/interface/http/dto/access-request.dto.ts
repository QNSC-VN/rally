import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

// `AssignRoleSchema`, `UpdateRolePermissionsSchema` and `CreateRoleSchema` are GONE with the routes
// that carried them (ruling 2026-08-14, AC-11: no editable permission matrix, no custom roles). Their
// only consumers were `POST /roles`, `PATCH /roles/:roleId/permissions` and `POST /role-assignments`.
// Deleted rather than left exported — an unused request schema is an invitation to re-add the route.

/** Body for project-scoped role assignment — scope is fixed to the URL project. */
export const AssignProjectRoleSchema = z.object({
  userId: z.string().uuid(),
  roleId: z.string().uuid(),
});
export class AssignProjectRoleDto extends createZodDto(AssignProjectRoleSchema) {}
