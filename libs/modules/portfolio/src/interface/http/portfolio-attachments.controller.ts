import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Redirect,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ApiCommonErrors, RateLimit } from '@platform';
import type { JwtPayload } from '@platform';
import { CurrentUser } from '@modules/identity';
import { AuthPolicy, RequirePermission } from '@modules/access';
import {
  AttachmentResponseDto,
  DownloadUrlResponseDto,
  EntityAttachmentsService,
  PresignAttachmentDto,
  PresignAttachmentResponseDto,
  type EntityAttachment,
} from '@modules/attachments';
import { PortfolioItemsService } from '../../application/portfolio-items.service';

function toAttachmentDto(a: EntityAttachment): AttachmentResponseDto {
  return {
    id: a.id,
    entityType: a.entityType,
    entityId: a.entityId,
    uploadedBy: a.uploadedBy,
    filename: a.filename,
    mimeType: a.mimeType,
    sizeBytes: Number(a.sizeBytes),
    createdAt: a.createdAt.toISOString(),
  };
}

/**
 * Attachments on a PORTFOLIO ITEM (Epic or Feature).
 *
 * The routes live HERE rather than in `@modules/attachments` because that module states the
 * rule and it is the right one: upload mechanics are shared, but routes and authorization
 * stay with the owning context, so authorization can never degrade into an owner-type
 * registry lookup. So this controller owns exactly two things — the `portfolio:view` /
 * `portfolio:edit` gates, and resolving the item to prove it exists and to get the
 * `projectId` the activity log needs. Everything else is `EntityAttachmentsService`, byte for
 * byte the same code path a work-item upload takes.
 *
 * The route shape deliberately mirrors `/v1/work-items/:id/attachments/*` verb for verb,
 * including `/content` — that is the stable, re-authorized URL safe to put in an `<img src>`
 * inside rich text, which the shared `RichTextEditor` needs on this page too.
 */
@ApiTags('Portfolio')
@Controller('portfolio-items/:id/attachments')
@AuthPolicy()
export class PortfolioAttachmentsController {
  constructor(
    private readonly items: PortfolioItemsService,
    private readonly attachments: EntityAttachmentsService,
  ) {}

  /**
   * Proves the item exists and is visible, and yields the project for the activity log.
   *
   * `'write'` additionally refuses an ARCHIVED project (PRJ-FR-010) through
   * `PortfolioItemsService.getItemForWrite`, which is the only place that rule is stated for a
   * portfolio item. Presign/confirm/delete pass it; the four read routes do not, because a read
   * is never guarded — archived means read-only, not invisible, so an archived project's
   * attachments must still be listable and downloadable.
   */
  private async subject(user: JwtPayload, id: string, mode: 'read' | 'write' = 'read') {
    const item =
      mode === 'write'
        ? await this.items.getItemForWrite(user, id)
        : await this.items.getItem(user, id);
    return {
      ref: { entityType: 'portfolio_item' as const, entityId: id },
      projectId: item.projectId,
    };
  }

  @Post('presign')
  @RateLimit('STRICT')
  @ApiOperation({ summary: 'Get a presigned S3 PUT URL to attach a file to an Epic or Feature' })
  @RequirePermission('portfolio:edit', { resource: 'portfolio_item', from: 'param', field: 'id' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 201, type: PresignAttachmentResponseDto })
  @ApiCommonErrors(400, 401, 404, 422)
  async presign(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PresignAttachmentDto,
  ): Promise<PresignAttachmentResponseDto> {
    const { ref } = await this.subject(user, id, 'write');
    return this.attachments.presign(user, ref, {
      filename: dto.filename,
      mimeType: dto.mimeType,
      sizeBytes: dto.sizeBytes,
      checksumSha256: dto.checksumSha256,
    });
  }

  @Post(':aid/confirm')
  @HttpCode(200)
  @ApiOperation({ summary: 'Confirm the upload completed — activates the attachment' })
  @RequirePermission('portfolio:edit', { resource: 'portfolio_item', from: 'param', field: 'id' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'aid', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, type: AttachmentResponseDto })
  @ApiCommonErrors(400, 401, 404, 422)
  async confirm(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('aid', ParseUUIDPipe) aid: string,
  ): Promise<AttachmentResponseDto> {
    const { ref, projectId } = await this.subject(user, id, 'write');
    return toAttachmentDto(await this.attachments.confirm(user, ref, aid, projectId));
  }

  @Get()
  @ApiOperation({ summary: 'List completed attachments on an Epic or Feature' })
  @RequirePermission('portfolio:view', { resource: 'portfolio_item', from: 'param', field: 'id' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, type: AttachmentResponseDto, isArray: true })
  @ApiCommonErrors(401, 404)
  async list(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AttachmentResponseDto[]> {
    const { ref } = await this.subject(user, id);
    const rows = await this.attachments.list(user, ref);
    return rows.map(toAttachmentDto);
  }

  @Get(':aid/download')
  @ApiOperation({ summary: 'Get a presigned S3 GET URL for an attachment' })
  @RequirePermission('portfolio:view', { resource: 'portfolio_item', from: 'param', field: 'id' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'aid', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, type: DownloadUrlResponseDto })
  @ApiCommonErrors(401, 404)
  async downloadUrl(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('aid', ParseUUIDPipe) aid: string,
  ): Promise<DownloadUrlResponseDto> {
    const { ref } = await this.subject(user, id);
    return this.attachments.downloadUrl(user, ref, aid);
  }

  /**
   * Stable, authenticated URL for the bytes — see the work-item twin. Never expires, so it
   * is the only URL safe to persist in rich-text content; every access is re-authorized.
   * 302, not 307, so the browser follows with GET and does not resend the session cookie to
   * the bucket origin.
   */
  @Get(':aid/content')
  @Redirect(undefined, 302)
  @ApiOperation({ summary: 'Redirect to the attachment bytes (stable, authenticated URL)' })
  @RequirePermission('portfolio:view', { resource: 'portfolio_item', from: 'param', field: 'id' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'aid', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 302, description: 'Redirect to a short-lived presigned URL' })
  @ApiCommonErrors(401, 404)
  async content(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('aid', ParseUUIDPipe) aid: string,
  ): Promise<{ url: string; statusCode: number }> {
    const { ref } = await this.subject(user, id);
    const { downloadUrl } = await this.attachments.downloadUrl(user, ref, aid);
    return { url: downloadUrl, statusCode: 302 };
  }

  @Delete(':aid')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete an attachment (uploader or admin only)' })
  @RequirePermission('portfolio:edit', { resource: 'portfolio_item', from: 'param', field: 'id' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'aid', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Attachment deleted' })
  @ApiCommonErrors(401, 403, 404)
  async remove(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('aid', ParseUUIDPipe) aid: string,
  ): Promise<void> {
    const { ref, projectId } = await this.subject(user, id, 'write');
    await this.attachments.delete(user, ref, aid, projectId);
  }
}
