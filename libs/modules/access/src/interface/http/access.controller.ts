import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Auth, ApiCommonErrors, RequirePermission } from '@platform';
import type { JwtPayload } from '@platform';
import { CurrentUser } from '@platform';
import { AccessService } from '../../application/access.service';
import { AssignRoleDto } from './dto/access-request.dto';
import { RoleResponseDto, RoleAssignmentResponseDto } from './dto/access-response.dto';
import type { SystemRole, UserRoleAssignment } from '../../domain/access.types';

function toRoleDto(r: SystemRole): RoleResponseDto {
  return {
    id: r.id,
    tenantId: r.tenantId,
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
    tenantId: a.tenantId,
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
@Auth()
export class AccessController {
  constructor(private readonly accessService: AccessService) {}

  // ── Roles ──────────────────────────────────────────────────────────────────

  @Get('roles')
  @ApiOperation({ summary: 'List all roles available to the tenant' })
  @ApiResponse({ status: 200, type: [RoleResponseDto] })
  @ApiCommonErrors(401)
  async listRoles(@CurrentUser() user: JwtPayload): Promise<RoleResponseDto[]> {
    const roles = await this.accessService.listRoles(user.tenantId);
    return roles.map(toRoleDto);
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
    const assignments = await this.accessService.getUserAssignments(user.tenantId, userId);
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
}
