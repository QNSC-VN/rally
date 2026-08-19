import { Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { ApiCommonErrors } from '@platform';
import type { JwtPayload } from '@platform';
import { AuthPolicy, RequirePermission } from '@modules/access';
import { CurrentUser } from '@modules/identity';
import { PERMISSION } from '@shared-kernel';

import { ApiTokensService } from '../../application/api-tokens.service';
import { ApiTokenResponseDto, toApiTokenResponse } from './dto/api-token.dto';
import { SessionAuthOnly } from './session-auth-only.decorator';

/**
 * The administrator's view of machine credentials in a workspace.
 *
 * This exists for one question, asked after somebody leaves or a secret leaks: what still has access,
 * and whose is it? A workspace administrator who cannot enumerate live tokens cannot answer it, and
 * per-user self-service alone never can.
 *
 * `api_token:manage_all` is workspace-tier, so `@RequirePermission` takes no scope. Each route also uses
 * {@link SessionAuthOnly}, refusing a token-authenticated caller: an administrator's leaked token must
 * not be able to revoke everyone else's, which is a denial of service against every integration in the
 * workspace.
 */
@ApiTags('api-tokens')
@Controller('api-tokens')
@AuthPolicy()
export class ApiTokensAdminController {
  constructor(private readonly tokens: ApiTokensService) {}

  @Get()
  @SessionAuthOnly()
  @RequirePermission(PERMISSION.API_TOKEN_MANAGE_ALL)
  @ApiOperation({
    summary: 'List every live API token in the workspace',
    description:
      'Live tokens only. Revoked ones are history and belong to their owner’s list; this surface ' +
      'answers "what still has access".',
  })
  @ApiResponse({ status: 200, type: ApiTokenResponseDto, isArray: true })
  @ApiCommonErrors(401, 403)
  async list(@CurrentUser() user: JwtPayload): Promise<ApiTokenResponseDto[]> {
    return (await this.tokens.listWorkspace(user.workspaceId)).map(toApiTokenResponse);
  }

  @Delete(':id')
  @HttpCode(204)
  @SessionAuthOnly()
  @RequirePermission(PERMISSION.API_TOKEN_MANAGE_ALL)
  @ApiOperation({ summary: 'Revoke any API token in the workspace' })
  @ApiResponse({
    status: 204,
    description: 'Revoked, or already revoked — the call is idempotent.',
  })
  @ApiCommonErrors(401, 403, 404)
  async revoke(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.tokens.revokeAsAdmin(user.workspaceId, id, user.sub);
  }
}
