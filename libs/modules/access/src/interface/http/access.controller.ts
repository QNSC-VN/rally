import { Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ApiCommonErrors } from '@platform';
import type { JwtPayload } from '@platform';
import { CurrentUser } from '@platform';
import { AccessService } from '../../application/access.service';
import { AuthPolicy, RequirePermission } from './policy.guard';
import {
  RoleResponseDto,
  RoleAssignmentResponseDto,
  ProjectPermissionsResponseDto,
} from './dto/access-response.dto';
import type { SystemRole, UserRoleAssignment } from '../../domain/access.types';
import { SelfScoped, SharedRead } from './policy.guard';

function toRoleDto(r: SystemRole): RoleResponseDto {
  return {
    id: r.id,
    workspaceId: r.workspaceId,
    name: r.name,
    slug: r.slug,
    description: r.description,
    isSystem: r.isSystem,
    permissions: r.permissions,
    createdAt: r.createdAt.toISOString(),
  };
}

function toAssignmentDto(a: UserRoleAssignment): RoleAssignmentResponseDto {
  return {
    id: a.id,
    workspaceId: a.workspaceId,
    userId: a.userId,
    roleId: a.roleId,
    scopeType: a.scopeType,
    scopeId: a.scopeId,
    grantedBy: a.grantedBy,
    createdAt: a.createdAt.toISOString(),
  };
}

@ApiTags('access')
@Controller()
@AuthPolicy()
export class AccessController {
  constructor(private readonly accessService: AccessService) {}

  // ── Roles ──────────────────────────────────────────────────────────────────

  @Get('roles')
  @SharedRead('the role catalogue is workspace reference data every member sees in pickers')
  @ApiOperation({ summary: 'List all roles available to the workspace' })
  @ApiResponse({ status: 200, type: [RoleResponseDto] })
  @ApiCommonErrors(401)
  async listRoles(@CurrentUser() user: JwtPayload): Promise<RoleResponseDto[]> {
    const roles = await this.accessService.listRoles(user.workspaceId);
    return roles.map(toRoleDto);
  }

  // ── Custom roles are GONE (ruling 2026-08-14) ───────────────────────────────
  //
  // `POST /roles`, `PATCH /roles/:roleId/permissions`, `DELETE /roles/:roleId`,
  // `POST /role-assignments` and `GET /permissions` are removed. AC-11 makes the Permission Model
  // read-only with no editable matrix, `db/permissions.catalog.ts` is the single source of truth a
  // custom matrix would fork, and — the deciding reason — custom-role CRUD plus WORKSPACE-scoped
  // tier-role assignment together re-create exactly the company-wide over-grant migration 0111
  // removed. The editing UI was already dead code (`RoleEditorDialog` unreferenced), so nothing
  // reachable called these.
  //
  // What deliberately STAYS:
  //   • `GET /roles` — workspace reference data every member sees in pickers.
  //   • `GET /users/:userId/role-assignments` — a read, and the read-only Permission Model needs it.
  //   • `DELETE /role-assignments/:id` — REVOKING an existing workspace-scoped assignment must remain
  //     possible after creating one stops being possible. Losing the ability to undo a grant you can
  //     no longer make is the wrong direction to fail in, and the removal migration (still gated on
  //     the dry-run report) needs this path to exist.
  //
  // The read-only Permission Model tab renders from the FE catalogue mirror, not from `GET
  // /permissions`, so removing that route does not touch it.

  // ── Role assignments ───────────────────────────────────────────────────────

  @Get('users/:userId/role-assignments')
  @RequirePermission('roles:view')
  @ApiOperation({ summary: "Get a user's role assignments" })
  @ApiParam({ name: 'userId', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, type: [RoleAssignmentResponseDto] })
  @ApiCommonErrors(401, 403, 404)
  async getUserAssignments(
    @CurrentUser() user: JwtPayload,
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<RoleAssignmentResponseDto[]> {
    const assignments = await this.accessService.getUserAssignments(user.workspaceId, userId);
    return assignments.map(toAssignmentDto);
  }

  @Delete('role-assignments/:id')
  @RequirePermission('users:assign_role')
  @HttpCode(204)
  @ApiOperation({ summary: 'Revoke a role assignment (workspace admin only)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Role assignment revoked' })
  @ApiCommonErrors(401, 403, 404)
  async revokeRole(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.accessService.revokeRole(user, id);
  }

  // ── Project-scoped membership ────────────────────────────────────────────────

  @Get('projects/:projectId/my-permissions')
  @SelfScoped("resolves the caller's own effective permissions")
  @ApiOperation({
    summary: "The current user's effective permissions for a project",
    description:
      'Baseline (workspace-wide) permissions unioned with any project-scoped role. ' +
      'Used by the frontend to gate project-scoped UI accurately.',
  })
  @ApiParam({ name: 'projectId', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, type: ProjectPermissionsResponseDto })
  @ApiCommonErrors(401)
  async getMyProjectPermissions(
    @CurrentUser() user: JwtPayload,
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ): Promise<ProjectPermissionsResponseDto> {
    const permissions = await this.accessService.getProjectPermissions(
      user.sub,
      user.workspaceId,
      projectId,
    );
    return { projectId, permissions };
  }
}
