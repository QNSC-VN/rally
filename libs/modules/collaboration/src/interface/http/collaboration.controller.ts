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
 * Comments and attachments on a WORK ITEM.
 *
 * The routes are per-entity rather than one generic `/comments?entityType=…` because
 * `@RequirePermission` is resource-typed: a work-item comment is gated on
 * `work_item:view`/`work_item:edit` against the work item's project, and a portfolio one on
 * `portfolio:view`/`portfolio:edit` against the Feature's. A single route could not express
 * both without moving authorization out of the guard, which is the one place this codebase
 * keeps it. The SERVICE underneath is entity-generic; only the door is per-entity.
 */
@ApiTags('collaboration')
@Controller('work-items/:workItemId')
@AuthPolicy()
export class CollaborationController {
  constructor(private readonly collaborationService: CollaborationService) {}

  // ── Comments ───────────────────────────────────────────────────────────────

  @Get('comments')
  @RequirePermission('work_item:view', {
    resource: 'work_item',
    from: 'param',
    field: 'workItemId',
  })
  @ApiOperation({ summary: 'List comments for a work item' })
  @ApiParam({ name: 'workItemId', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, type: [CommentResponseDto] })
  @ApiCommonErrors(401, 404)
  async listComments(
    @CurrentUser() user: JwtPayload,
    @Param('workItemId', ParseUUIDPipe) workItemId: string,
  ): Promise<CommentResponseDto[]> {
    const comments = await this.collaborationService.listComments(user, {
      entityType: 'work_item',
      entityId: workItemId,
    });
    return comments.map(toCommentDto);
  }

  @Post('comments')
  @RequirePermission('work_item:edit', {
    resource: 'work_item',
    from: 'param',
    field: 'workItemId',
  })
  @ApiOperation({ summary: 'Add a comment to a work item' })
  @ApiParam({ name: 'workItemId', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 201, type: CommentResponseDto })
  @ApiCommonErrors(400, 401, 422)
  async createComment(
    @CurrentUser() user: JwtPayload,
    @Param('workItemId', ParseUUIDPipe) workItemId: string,
    @Body() dto: CreateCommentDto,
  ): Promise<CommentResponseDto> {
    const comment = await this.collaborationService.createComment(
      user,
      { entityType: 'work_item', entityId: workItemId },
      dto.body,
      dto.parentId,
      dto.mentionedUserIds,
    );
    return toCommentDto(comment);
  }

  @Patch('comments/:commentId')
  @ApiOperation({ summary: 'Update a comment' })
  @ApiParam({ name: 'workItemId', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'commentId', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, type: CommentResponseDto })
  @ApiCommonErrors(400, 401, 404, 422)
  async updateComment(
    @CurrentUser() user: JwtPayload,
    @Param('commentId', ParseUUIDPipe) commentId: string,
    @Body() dto: UpdateCommentDto,
  ): Promise<CommentResponseDto> {
    const comment = await this.collaborationService.updateComment(user, commentId, dto.body);
    return toCommentDto(comment);
  }

  @Delete('comments/:commentId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a comment (soft delete)' })
  @ApiParam({ name: 'workItemId', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'commentId', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Comment deleted' })
  @ApiCommonErrors(401, 404)
  async deleteComment(
    @CurrentUser() user: JwtPayload,
    @Param('commentId', ParseUUIDPipe) commentId: string,
  ): Promise<void> {
    await this.collaborationService.deleteComment(user, commentId);
  }
}
