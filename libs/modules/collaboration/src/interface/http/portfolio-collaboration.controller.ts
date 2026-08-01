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
import { ApiCommonErrors } from '@platform';
import type { JwtPayload } from '@platform';
import { CurrentUser } from '@modules/identity';
import { AuthPolicy, RequirePermission } from '@modules/access';
import { CollaborationService } from '../../application/collaboration.service';
import { CreateCommentDto, UpdateCommentDto } from './dto/collaboration-request.dto';
import { CommentResponseDto, toCommentDto } from './dto/collaboration-response.dto';

/**
 * Comments on a PORTFOLIO ITEM (Epic or Feature).
 *
 * A separate controller rather than extra routes on `PortfolioItemsController`, for two
 * reasons that both point the same way:
 *
 * 1. **No module cycle.** `CollaborationModule` already imports `PortfolioModule` to
 *    resolve a Feature's project for the permission check. Putting these routes on the
 *    portfolio controller would need `PortfolioModule` to import Collaboration back, and
 *    the pair would only load behind `forwardRef`. Comments belong to the collaboration
 *    module; the entity it hangs off does not change that.
 *
 * 2. **The guard is resource-typed.** `@RequirePermission` resolves a concrete resource to
 *    find the owning project, so one generic `/comments?entityType=…` route could not gate
 *    a work-item comment on `work_item:edit` and a portfolio one on `portfolio:edit`. Two
 *    doors, one entity-generic service behind them.
 *
 * Update and delete ARE mirrored here even though the work-item versions already resolve
 * their subject from the loaded comment and would function for either entity type. The
 * alternative was for the client to edit a portfolio comment through
 * `/v1/work-items/<portfolio-item-id>/comments/:commentId` — a path segment that names one
 * table and carries an id from another. Both handlers ignore `:id` for the same reason the
 * work-item ones ignore `:workItemId`; authorization comes from the comment's own subject,
 * via `assertCanCollaborate`, so it is correct for both.
 */
@ApiTags('collaboration')
@Controller('portfolio-items/:id')
@AuthPolicy()
export class PortfolioCollaborationController {
  constructor(private readonly collaboration: CollaborationService) {}

  @Get('comments')
  @RequirePermission('portfolio:view', { resource: 'portfolio_item', from: 'param', field: 'id' })
  @ApiOperation({ summary: 'List comments on an Epic or Feature' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, type: [CommentResponseDto] })
  @ApiCommonErrors(401, 404)
  async listComments(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CommentResponseDto[]> {
    const rows = await this.collaboration.listComments(user, {
      entityType: 'portfolio_item',
      entityId: id,
    });
    return rows.map(toCommentDto);
  }

  @Post('comments')
  @RequirePermission('portfolio:edit', { resource: 'portfolio_item', from: 'param', field: 'id' })
  @ApiOperation({ summary: 'Add a comment to an Epic or Feature' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 201, type: CommentResponseDto })
  @ApiCommonErrors(400, 401, 422)
  async createComment(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateCommentDto,
  ): Promise<CommentResponseDto> {
    const comment = await this.collaboration.createComment(
      user,
      { entityType: 'portfolio_item', entityId: id },
      dto.body,
      dto.parentId,
      dto.mentionedUserIds,
    );
    return toCommentDto(comment);
  }

  @Patch('comments/:commentId')
  @ApiOperation({ summary: 'Update a comment on an Epic or Feature' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'commentId', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, type: CommentResponseDto })
  @ApiCommonErrors(400, 401, 404, 422)
  async updateComment(
    @CurrentUser() user: JwtPayload,
    @Param('commentId', ParseUUIDPipe) commentId: string,
    @Body() dto: UpdateCommentDto,
  ): Promise<CommentResponseDto> {
    const comment = await this.collaboration.updateComment(user, commentId, dto.body);
    return toCommentDto(comment);
  }

  @Delete('comments/:commentId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a comment on an Epic or Feature (soft delete)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'commentId', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Comment deleted' })
  @ApiCommonErrors(401, 404)
  async deleteComment(
    @CurrentUser() user: JwtPayload,
    @Param('commentId', ParseUUIDPipe) commentId: string,
  ): Promise<void> {
    await this.collaboration.deleteComment(user, commentId);
  }
}
