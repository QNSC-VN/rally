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
import { CurrentUser } from '@modules/identity';
import { CollaborationService } from '../../application/collaboration.service';
import {
  CreateCommentDto,
  UpdateCommentDto,
} from './dto/collaboration-request.dto';
import { CommentResponseDto } from './dto/collaboration-response.dto';
import type { Comment } from '../../domain/collaboration.types';

function toCommentDto(c: Comment): CommentResponseDto {
  return {
    id: c.id,
    workItemId: c.workItemId,
    authorId: c.authorId,
    body: c.body,
    parentId: c.parentId,
    isEdited: c.isEdited,
    editedAt: c.editedAt?.toISOString() ?? null,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

@ApiTags('collaboration')
@Controller('work-items/:workItemId')
@Auth()
export class CollaborationController {
  constructor(private readonly collaborationService: CollaborationService) {}

  // ── Comments ───────────────────────────────────────────────────────────────

  @Get('comments')
  @ApiOperation({ summary: 'List comments for a work item' })
  @ApiParam({ name: 'workItemId', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, type: [CommentResponseDto] })
  @ApiCommonErrors(401, 404)
  async listComments(
    @CurrentUser() user: JwtPayload,
    @Param('workItemId', ParseUUIDPipe) workItemId: string,
  ): Promise<CommentResponseDto[]> {
    const comments = await this.collaborationService.listComments(user, workItemId);
    return comments.map(toCommentDto);
  }

  @Post('comments')
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
      workItemId,
      dto.body,
      dto.parentId,
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

