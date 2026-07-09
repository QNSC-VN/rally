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
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiExcludeEndpoint,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  Auth,
  ApiCommonErrors,
  ApiPagedResponse,
  buildPageArgs,
  PageQueryDto,
  UseIdempotency,
  RateLimit,
  RequirePermission,
  NotFoundException,
} from '@platform';
import type { JwtPayload, PagedResult } from '@platform';
import { CurrentUser } from '@modules/identity/interface/http/decorators/current-user.decorator';
import { WorkspaceService } from '../../application/workspace.service';
import {
  CreateWorkspaceDto,
  UpdateWorkspaceDto,
  AddMemberDto,
  UpdateMemberDto,
  InviteMemberDto,
  AcceptInvitationDto,
  UpdateWorkspaceSettingsDto,
} from './dto/workspace-request.dto';
import {
  WorkspaceResponseDto,
  MemberResponseDto,
  MemberWithProfileResponseDto,
  InvitationResponseDto,
  WorkspaceSettingsResponseDto,
} from './dto/workspace-response.dto';
import type {
  Workspace,
  WorkspaceMember,
  WorkspaceInvitation,
  WorkspaceSettings,
} from '../../domain/workspace.types';

// ── Mappers ──────────────────────────────────────────────────────────────────

function toWorkspaceDto(w: Workspace): WorkspaceResponseDto {
  return {
    id: w.id,
    slug: w.slug,
    name: w.name,
    description: w.description,
    avatarUrl: w.avatarUrl,
    settings: w.settings,
    createdAt: w.createdAt.toISOString(),
    updatedAt: w.updatedAt.toISOString(),
  };
}

function toMemberDto(m: WorkspaceMember): MemberResponseDto {
  return {
    id: m.id,
    workspaceId: m.workspaceId,
    userId: m.userId,
    roleId: m.roleId,
    status: m.status,
    joinedAt: m.joinedAt?.toISOString() ?? new Date().toISOString(),
    createdAt: m.createdAt.toISOString(),
  };
}

function toInvitationDto(i: WorkspaceInvitation): InvitationResponseDto {
  return {
    id: i.id,
    workspaceId: i.workspaceId,
    email: i.email,
    roleId: i.roleId,
    status: i.status,
    invitedBy: i.invitedBy,
    expiresAt: i.expiresAt.toISOString(),
    acceptedBy: i.acceptedBy,
    acceptedAt: i.acceptedAt?.toISOString() ?? null,
    createdAt: i.createdAt.toISOString(),
  };
}

function toSettingsDto(s: WorkspaceSettings): WorkspaceSettingsResponseDto {
  return {
    workspaceId: s.workspaceId,
    timezone: s.timezone,
    defaultLocale: s.defaultLocale,
    dateFormat: s.dateFormat,
    updatedAt: s.updatedAt.toISOString(),
  };
}

// ── Controllers ──────────────────────────────────────────────────────────────

@ApiTags('workspaces')
@Controller('workspaces')
@Auth()
export class WorkspaceController {
  constructor(private readonly workspaceService: WorkspaceService) {}

  /**
   * Guard: workspace-scoped routes operate strictly on the caller's active
   * workspace. A path id that isn't the active workspace is treated as
   * not-found so we never leak the existence of other workspaces.
   */
  private assertActive(user: JwtPayload, id: string): void {
    if (id !== user.workspaceId) {
      throw new NotFoundException('WORKSPACE_NOT_FOUND', 'Workspace not found');
    }
  }

  // ── List workspaces ────────────────────────────────────────────────────────

  @Get()
  @ApiOperation({ summary: 'List workspaces the authenticated user belongs to' })
  @ApiPagedResponse(WorkspaceResponseDto)
  @ApiCommonErrors(401)
  async listWorkspaces(
    @CurrentUser() user: JwtPayload,
    @Query() query: PageQueryDto,
  ): Promise<PagedResult<WorkspaceResponseDto>> {
    const args = buildPageArgs(query);
    const page = await this.workspaceService.listWorkspacesForUser(user.sub, args);
    return { data: page.data.map(toWorkspaceDto), pageInfo: page.pageInfo };
  }

  // ── Create workspace ───────────────────────────────────────────────────────
  // MVP constraint: workspace provisioning is system-only (COMPANY-FR-010).

  @Post()
  @RequirePermission('workspace:create')
  @ApiExcludeEndpoint()
  @ApiOperation({ summary: 'Create a new workspace' })
  @ApiResponse({ status: 201, type: WorkspaceResponseDto })
  @ApiCommonErrors(400, 401, 409, 422)
  async createWorkspace(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateWorkspaceDto,
  ): Promise<WorkspaceResponseDto> {
    const workspace = await this.workspaceService.createWorkspace(
      user,
      dto.slug,
      dto.name,
      dto.description,
      dto.avatarUrl,
    );
    return toWorkspaceDto(workspace);
  }

  // ── Get workspace ──────────────────────────────────────────────────────────

  @Get(':id')
  @ApiOperation({ summary: 'Get workspace details' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, type: WorkspaceResponseDto })
  @ApiCommonErrors(401, 404)
  async getWorkspace(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<WorkspaceResponseDto> {
    this.assertActive(user, id);
    const workspace = await this.workspaceService.getWorkspace(id);
    return toWorkspaceDto(workspace);
  }

  // ── Update workspace ───────────────────────────────────────────────────────

  @Patch(':id')
  @RequirePermission('workspace:*')
  @ApiOperation({ summary: 'Update workspace' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, type: WorkspaceResponseDto })
  @ApiCommonErrors(400, 401, 404, 422)
  async updateWorkspace(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateWorkspaceDto,
  ): Promise<WorkspaceResponseDto> {
    this.assertActive(user, id);
    const workspace = await this.workspaceService.updateWorkspace(id, dto);
    return toWorkspaceDto(workspace);
  }

  // ── Delete workspace ───────────────────────────────────────────────────────
  // MVP constraint: workspace archival is system-only (COMPANY-FR-010).

  @Delete(':id')
  @RequirePermission('workspace:*')
  @ApiExcludeEndpoint()
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete workspace (soft delete)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Workspace deleted' })
  @ApiCommonErrors(401, 404)
  async deleteWorkspace(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    this.assertActive(user, id);
    await this.workspaceService.deleteWorkspace(id);
  }

  // ── List members ───────────────────────────────────────────────────────────

  @Get(':id/members')
  @ApiOperation({ summary: 'List workspace members' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiPagedResponse(MemberResponseDto)
  @ApiCommonErrors(401, 404)
  async listMembers(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: PageQueryDto,
  ): Promise<PagedResult<MemberResponseDto>> {
    this.assertActive(user, id);
    const args = buildPageArgs(query);
    const page = await this.workspaceService.listMembers(id, args);
    return { data: page.data.map(toMemberDto), pageInfo: page.pageInfo };
  }

  // ── List members with profile (for User Management UI) ─────────────────────

  @Get(':id/members-with-profile')
  @ApiOperation({ summary: 'List workspace members with user profile and role details' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, type: MemberWithProfileResponseDto, isArray: true })
  @ApiCommonErrors(401, 404)
  async listMembersWithProfile(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<MemberWithProfileResponseDto[]> {
    this.assertActive(user, id);
    return this.workspaceService.listMembersWithProfile(id) as unknown as Promise<
      MemberWithProfileResponseDto[]
    >;
  }

  // ── Add member ─────────────────────────────────────────────────────────────

  @Post(':id/members')
  @RequirePermission('workspace:manage_members')
  @ApiOperation({ summary: 'Add a user to the workspace' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 201, type: MemberResponseDto })
  @ApiCommonErrors(400, 401, 404, 409, 422)
  async addMember(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddMemberDto,
  ): Promise<MemberResponseDto> {
    this.assertActive(user, id);
    const member = await this.workspaceService.addMember(id, dto.userId, user.sub);
    return toMemberDto(member);
  }

  // ── Update member ──────────────────────────────────────────────────────────

  @Patch(':id/members/:memberId')
  @RequirePermission('workspace:manage_members')
  @ApiOperation({ summary: 'Update member role or status' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'memberId', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, type: MemberResponseDto })
  @ApiCommonErrors(400, 401, 404, 409, 422)
  async updateMember(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @Body() dto: UpdateMemberDto,
  ): Promise<MemberResponseDto> {
    this.assertActive(user, id);
    const member = await this.workspaceService.updateMember(
      id,
      memberId,
      dto,
      user.sub,
    );
    return toMemberDto(member);
  }

  // ── Remove member ──────────────────────────────────────────────────────────

  @Delete(':id/members/:userId')
  @RequirePermission('workspace:manage_members')
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove a user from the workspace' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'userId', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Member removed' })
  @ApiCommonErrors(401, 404)
  async removeMember(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<void> {
    this.assertActive(user, id);
    await this.workspaceService.removeMember(id, userId, user.sub);
  }

  // ── Invite member ──────────────────────────────────────────────────────────

  @Post(':id/invitations')
  @RequirePermission('workspace:manage_members')
  @UseIdempotency()
  @RateLimit('STRICT')
  @ApiOperation({ summary: 'Invite a user to the workspace by email' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 201, type: InvitationResponseDto })
  @ApiCommonErrors(400, 401, 409, 422)
  async inviteMember(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: InviteMemberDto,
  ): Promise<InvitationResponseDto> {
    this.assertActive(user, id);
    const invitation = await this.workspaceService.inviteMember(
      id,
      dto.email,
      dto.roleId,
      user.sub,
    );
    return toInvitationDto(invitation);
  }

  // ── List invitations ───────────────────────────────────────────────────────

  @Get(':id/invitations')
  @ApiOperation({ summary: 'List invitations for a workspace' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, type: [InvitationResponseDto] })
  @ApiCommonErrors(401, 404)
  async listInvitations(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<InvitationResponseDto[]> {
    this.assertActive(user, id);
    const invitations = await this.workspaceService.listInvitations(id);
    return invitations.map(toInvitationDto);
  }

  // ── Cancel invitation ──────────────────────────────────────────────────────

  @Delete(':id/invitations/:invitationId')
  @RequirePermission('workspace:manage_members')
  @HttpCode(204)
  @ApiOperation({ summary: 'Cancel a pending workspace invitation' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'invitationId', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Invitation cancelled' })
  @ApiCommonErrors(401, 404)
  async cancelInvitation(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('invitationId', ParseUUIDPipe) invitationId: string,
  ): Promise<void> {
    this.assertActive(user, id);
    await this.workspaceService.cancelInvitation(id, invitationId, user.sub);
  }

  // ── Workspace settings ─────────────────────────────────────────────────────

  @Get(':id/settings')
  @ApiOperation({ summary: 'Get workspace settings' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, type: WorkspaceSettingsResponseDto })
  @ApiCommonErrors(401, 404)
  async getSettings(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<WorkspaceSettingsResponseDto> {
    this.assertActive(user, id);
    const settings = await this.workspaceService.getSettings(id);
    return toSettingsDto(settings);
  }

  @Patch(':id/settings')
  @RequirePermission('workspace:*')
  @ApiOperation({ summary: 'Update workspace settings' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, type: WorkspaceSettingsResponseDto })
  @ApiCommonErrors(400, 401, 404, 422)
  async updateSettings(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateWorkspaceSettingsDto,
  ): Promise<WorkspaceSettingsResponseDto> {
    this.assertActive(user, id);
    const settings = await this.workspaceService.updateSettings(id, dto);
    return toSettingsDto(settings);
  }
}

// ── Authenticated invitation accept ──────────────────────────────────────────
// Accepting an invitation requires the recipient to be authenticated first.
// The frontend flow: receive email → log in / register → POST /invitations/accept.

@ApiTags('invitations')
@Controller('invitations')
export class InvitationController {
  constructor(private readonly workspaceService: WorkspaceService) {}

  @Post('accept')
  @Auth()
  @HttpCode(204)
  @RateLimit('STRICT')
  @ApiOperation({ summary: 'Accept a workspace invitation (authenticated user only)' })
  @ApiBearerAuth('access-token')
  @ApiResponse({ status: 204, description: 'Invitation accepted' })
  @ApiCommonErrors(400, 401, 404, 422)
  async acceptInvitation(
    @Body() dto: AcceptInvitationDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<void> {
    await this.workspaceService.acceptInvitation(dto.token, user.sub);
  }
}
