import { Inject, Injectable, Logger } from '@nestjs/common';
import { uuidv7 } from 'uuidv7';
import { NotFoundException, PreconditionFailedException } from '@platform';
import type { JwtPayload } from '@platform';
import { ICommentRepository, COMMENT_REPOSITORY } from '../domain/ports/comment.repository';
import {
  IAttachmentRepository,
  ATTACHMENT_REPOSITORY,
} from '../domain/ports/attachment.repository';
import type { Comment, Attachment } from '../domain/collaboration.types';

@Injectable()
export class CollaborationService {
  private readonly logger = new Logger(CollaborationService.name);

  constructor(
    @Inject(COMMENT_REPOSITORY) private readonly commentRepo: ICommentRepository,
    @Inject(ATTACHMENT_REPOSITORY) private readonly attachmentRepo: IAttachmentRepository,
  ) {}

  // ── Comments ──────────────────────────────────────────────────────────────

  async listComments(actor: JwtPayload, workItemId: string): Promise<Comment[]> {
    return this.commentRepo.listByWorkItem(workItemId, actor.tenantId);
  }

  async createComment(
    actor: JwtPayload,
    workItemId: string,
    body: string,
    parentId?: string,
  ): Promise<Comment> {
    const comment = await this.commentRepo.create({
      id: uuidv7(),
      tenantId: actor.tenantId,
      workItemId,
      authorId: actor.sub,
      body,
      parentId,
    });
    this.logger.log({ commentId: comment.id, workItemId }, 'Comment created');
    return comment;
  }

  async updateComment(actor: JwtPayload, commentId: string, body: string): Promise<Comment> {
    const comment = await this.commentRepo.findById(commentId);
    if (!comment || comment.tenantId !== actor.tenantId || comment.deletedAt) {
      throw new NotFoundException('COMMENT_NOT_FOUND', 'Comment not found');
    }
    if (comment.authorId !== actor.sub) {
      throw new PreconditionFailedException(
        'COMMENT_NOT_OWNED',
        'You can only edit your own comments',
      );
    }
    return this.commentRepo.update(commentId, body);
  }

  async deleteComment(actor: JwtPayload, commentId: string): Promise<void> {
    const comment = await this.commentRepo.findById(commentId);
    if (!comment || comment.tenantId !== actor.tenantId || comment.deletedAt) {
      throw new NotFoundException('COMMENT_NOT_FOUND', 'Comment not found');
    }
    if (comment.authorId !== actor.sub) {
      throw new PreconditionFailedException(
        'COMMENT_NOT_OWNED',
        'You can only delete your own comments',
      );
    }
    await this.commentRepo.softDelete(commentId);
  }

  // ── Attachments ───────────────────────────────────────────────────────────

  async listAttachments(actor: JwtPayload, workItemId: string): Promise<Attachment[]> {
    return this.attachmentRepo.listByWorkItem(workItemId, actor.tenantId);
  }

  async createAttachment(
    actor: JwtPayload,
    workItemId: string,
    input: {
      filename: string;
      mimeType: string;
      sizeBytes: number;
      storageKey: string;
    },
  ): Promise<Attachment> {
    const attachment = await this.attachmentRepo.create({
      id: uuidv7(),
      tenantId: actor.tenantId,
      workItemId,
      uploadedBy: actor.sub,
      ...input,
    });
    this.logger.log({ attachmentId: attachment.id, workItemId }, 'Attachment created');
    return attachment;
  }

  async deleteAttachment(actor: JwtPayload, attachmentId: string): Promise<void> {
    const attachment = await this.attachmentRepo.findById(attachmentId);
    if (!attachment || attachment.tenantId !== actor.tenantId || attachment.deletedAt) {
      throw new NotFoundException('ATTACHMENT_NOT_FOUND', 'Attachment not found');
    }
    await this.attachmentRepo.softDelete(attachmentId);
  }
}
