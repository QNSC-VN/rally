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
import { Auth, ApiCommonErrors } from '@platform';
import type { JwtPayload } from '@platform';
import { CurrentUser } from '@modules/identity/interface/http/decorators/current-user.decorator';
import { TeamService } from '../../application/team.service';
import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { teamStatusEnum } from '../../../../../../db/schema/enums';
import type { Team, TeamMember } from '../../domain/team.types';

// ── DTOs ──────────────────────────────────────────────────────────────────────

const CreateTeamSchema = z.object({
  name: z.string().min(1).max(255).trim(),
  key: z
    .string()
    .min(1)
    .max(20)
    .regex(/^[A-Z0-9]+$/i, 'Key must be alphanumeric'),
  description: z.string().max(1000).trim().optional(),
  leadId: z.string().uuid().optional(),
});
class CreateTeamDto extends createZodDto(CreateTeamSchema) {}

const UpdateTeamSchema = z.object({
  name: z.string().min(1).max(255).trim().optional(),
  description: z.string().max(1000).trim().nullable().optional(),
  leadId: z.string().uuid().nullable().optional(),
  status: z.enum(teamStatusEnum.enumValues).optional(),
});
class UpdateTeamDto extends createZodDto(UpdateTeamSchema) {}

const AddTeamMemberSchema = z.object({ userId: z.string().uuid() });
class AddTeamMemberDto extends createZodDto(AddTeamMemberSchema) {}

// ── Mappers ───────────────────────────────────────────────────────────────────

function toTeamDto(t: Team) {
  return {
    id: t.id,
    workspaceId: t.workspaceId,
    name: t.name,
    key: t.key,
    description: t.description,
    leadId: t.leadId,
    status: t.status,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}

function toTeamMemberDto(m: TeamMember) {
  return {
    id: m.id,
    teamId: m.teamId,
    userId: m.userId,
    status: m.status,
    joinedAt: m.joinedAt.toISOString(),
  };
}

// ── Controller ────────────────────────────────────────────────────────────────

@ApiTags('teams')
@Controller()
@Auth()
export class TeamController {
  constructor(private readonly teamService: TeamService) {}

  // Workspace-scoped team list + create
  @Get('workspaces/:workspaceId/teams')
  @ApiOperation({ summary: 'List teams in a workspace' })
  @ApiParam({ name: 'workspaceId', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, schema: { type: 'array', items: { type: 'object' } } })
  @ApiCommonErrors(401, 404)
  async listTeams(@Param('workspaceId', ParseUUIDPipe) workspaceId: string) {
    const teams = await this.teamService.listTeams(workspaceId);
    return teams.map(toTeamDto);
  }

  @Post('workspaces/:workspaceId/teams')
  @ApiOperation({ summary: 'Create a team in a workspace' })
  @ApiParam({ name: 'workspaceId', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 201, schema: { type: 'object' } })
  @ApiCommonErrors(400, 401, 409, 422)
  async createTeam(
    @CurrentUser() user: JwtPayload,
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Body() dto: CreateTeamDto,
  ) {
    const team = await this.teamService.createTeam(
      user.tenantId,
      workspaceId,
      dto.name,
      dto.key,
      dto.description,
      dto.leadId,
    );
    return toTeamDto(team);
  }

  // Individual team operations
  @Get('teams/:id')
  @ApiOperation({ summary: 'Get team details' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, schema: { type: 'object' } })
  @ApiCommonErrors(401, 404)
  async getTeam(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    const team = await this.teamService.getTeam(id, user.tenantId);
    return toTeamDto(team);
  }

  @Patch('teams/:id')
  @ApiOperation({ summary: 'Update team' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, schema: { type: 'object' } })
  @ApiCommonErrors(400, 401, 404, 422)
  async updateTeam(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTeamDto,
  ) {
    const team = await this.teamService.updateTeam(id, dto, user.tenantId);
    return toTeamDto(team);
  }

  // Team member operations
  @Get('teams/:id/members')
  @ApiOperation({ summary: 'List team members' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, schema: { type: 'array', items: { type: 'object' } } })
  @ApiCommonErrors(401, 404)
  async listTeamMembers(@CurrentUser() user: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    const members = await this.teamService.listTeamMembers(id, user.tenantId);
    return members.map(toTeamMemberDto);
  }

  @Post('teams/:id/members')
  @ApiOperation({ summary: 'Add a user to a team' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 201, schema: { type: 'object' } })
  @ApiCommonErrors(400, 401, 404, 409, 422)
  async addTeamMember(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddTeamMemberDto,
  ) {
    const member = await this.teamService.addTeamMember(id, dto.userId, user.tenantId);
    return toTeamMemberDto(member);
  }

  @Delete('teams/:id/members/:userId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove a user from a team' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'userId', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Member removed' })
  @ApiCommonErrors(401, 404)
  async removeTeamMember(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    await this.teamService.removeTeamMember(id, userId, user.tenantId);
  }
}
