import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ApiCommonErrors, RequirePermission } from '@platform';
import type { JwtPayload } from '@platform';
import { CurrentUser } from '@platform';
import { AccessService } from '../../application/access.service';
import { AuthProjectScoped, RequireProjectPermission } from './project-permission.guard';
import {
  AssignRoleDto,
  AssignProjectRoleDto,
  UpdateRolePermissionsDto,
} from './dto/access-request.dto';
import {
  RoleResponseDto,
  RoleAssignmentResponseDto,
  ProjectPermissionsResponseDto,
  PermissionCatalogResponseDto,
} from './dto/access-response.dto';
import type { SystemRole, UserRoleAssignment } from '../../domain/access.types';

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
@AuthProjectScoped()
export class AccessController {
  constructor(private readonly accessService: AccessService) {}

  // ── Roles ──────────────────────────────────────────────────────────────────

  @Get('roles')
  @ApiOperation({ summary: 'List all roles available to the workspace' })
  @ApiResponse({ status: 200, type: [RoleResponseDto] })
  @ApiCommonErrors(401)
  async listRoles(@CurrentUser() user: JwtPayload): Promise<RoleResponseDto[]> {
    const roles = await this.accessService.listRoles(user.workspaceId);
    return roles.map(toRoleDto);
  }

  @Get('permissions')
  @RequirePermission('workspace:manage_members')
  @ApiOperation({
    summary: 'List assignable permissions with their scope tier (workspace admin only)',
  })
  @ApiResponse({ status: 200, type: PermissionCatalogResponseDto })
  @ApiCommonErrors(401, 403)
  getPermissionCatalog(): PermissionCatalogResponseDto {
    return { permissions: this.accessService.getPermissionCatalog() };
  }

  @Patch('roles/:roleId/permissions')
  @RequirePermission('workspace:manage_members')
  @ApiOperation({ summary: 'Replace a custom role\u2019s permission set (workspace admin only)' })
  @ApiParam({ name: 'roleId', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, type: RoleResponseDto })
  @ApiCommonErrors(400, 401, 403, 404, 409, 422)
  async updateRolePermissions(
    @CurrentUser() user: JwtPayload,
    @Param('roleId', ParseUUIDPipe) roleId: string,
    @Body() dto: UpdateRolePermissionsDto,
  ): Promise<RoleResponseDto> {
    const role = await this.accessService.updateRolePermissions(user, roleId, dto.permissions);
    return toRoleDto(role);
  }

  // ── Role assignments ───────────────────────────────────────────────────────

  @Get('users/:userId/role-assignments')
  @ApiOperation({ summary: "Get a user's role assignments" })
  @ApiParam({ name: 'userId', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, type: [RoleAssignmentResponseDto] })
  @ApiCommonErrors(401, 404)
  async getUserAssignments(
    @CurrentUser() user: JwtPayload,
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<RoleAssignmentResponseDto[]> {
    const assignments = await this.accessService.getUserAssignments(user.workspaceId, userId);
    return assignments.map(toAssignmentDto);
  }

  @Post('role-assignments')
  @RequirePermission('workspace:manage_members')
  @ApiOperation({ summary: 'Assign a role to a user (workspace admin only)' })
  @ApiResponse({ status: 201, type: RoleAssignmentResponseDto })
  @ApiCommonErrors(400, 401, 403, 404, 409, 422)
  async assignRole(
    @CurrentUser() user: JwtPayload,
    @Body() dto: AssignRoleDto,
  ): Promise<RoleAssignmentResponseDto> {
    const assignment = await this.accessService.assignRole(
      user,
      dto.userId,
      dto.roleId,
      dto.scopeType,
      dto.scopeId,
    );
    return toAssignmentDto(assignment);
  }

  @Delete('role-assignments/:id')
  @RequirePermission('workspace:manage_members')
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

  @Post('projects/:projectId/role-assignments')
  @RequireProjectPermission('project:manage_members', 'param', 'projectId')
  @ApiOperation({
    summary: 'Assign a project-scoped role to a user (project admin)',
    description:
      'Grants a project-scoped role on this project. Only roles whose permissions ' +
      'are entirely project-tier may be granted here; workspace-level roles require ' +
      'the workspace-scoped endpoint.',
  })
  @ApiParam({ name: 'projectId', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 201, type: RoleAssignmentResponseDto })
  @ApiCommonErrors(400, 401, 403, 404, 409, 422)
  async assignProjectRole(
    @CurrentUser() user: JwtPayload,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: AssignProjectRoleDto,
  ): Promise<RoleAssignmentResponseDto> {
    const assignment = await this.accessService.assignProjectRole(
      user,
      projectId,
      dto.userId,
      dto.roleId,
    );
    return toAssignmentDto(assignment);
  }

  @Delete('projects/:projectId/role-assignments/:id')
  @RequireProjectPermission('project:manage_members', 'param', 'projectId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Revoke a project-scoped role assignment (project admin)' })
  @ApiParam({ name: 'projectId', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Role assignment revoked' })
  @ApiCommonErrors(401, 403, 404)
  async revokeProjectRole(
    @CurrentUser() user: JwtPayload,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.accessService.revokeProjectRole(user, projectId, id);
  }
}
