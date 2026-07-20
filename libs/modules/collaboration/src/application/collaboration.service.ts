import { Inject, Injectable, Logger } from '@nestjs/common';
import { uuidv7 } from 'uuidv7';
import { NotFoundException, PreconditionFailedException } from '@platform';
import type { JwtPayload } from '@platform';
import { PERMISSION } from '@shared-kernel';
import { WorkItemsService } from '@modules/work-items';
import { AccessService } from '@modules/access';
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
    private readonly workItemsService: WorkItemsService,
    private readonly accessService: AccessService,
  ) {}

  /**
   * Authorize a collaboration write against the OWNING project of the target
   * work item. Commenting is a work_item:edit action; resolving the item's
   * project makes it project-scoped like every other write (a workspace-wide
   * grant fast-paths; a project-scoped grant only applies to that project).
   */
  private async assertCanCollaborate(actor: JwtPayload, workItemId: string): Promise<void> {
    const item = await this.workItemsService.getWorkItem(actor.workspaceId, workItemId);
    await this.accessService.assertProjectPermission(
      actor,
      item.projectId,
      PERMISSION.WORK_ITEM_EDIT,
    );
  }

  // ── Comments ──────────────────────────────────────────────────────────────

  async listComments(actor: JwtPayload, workItemId: string): Promise<Comment[]> {
    return this.commentRepo.listByWorkItem(workItemId, actor.workspaceId);
  }

  async createComment(
    actor: JwtPayload,
    workItemId: string,
    body: string,
    parentId?: string,
    mentionedUserIds: string[] = [],
  ): Promise<Comment> {
    await this.assertCanCollaborate(actor, workItemId);
    const comment = await this.commentRepo.create({
      id: uuidv7(),
      workspaceId: actor.workspaceId,
      workItemId,
      authorId: actor.sub,
      body,
      parentId,
    });
    this.logger.log({ commentId: comment.id, workItemId }, 'Comment created');
    // F7 — notify watchers/assignee (comment) and any @mentioned users. Best-effort:
    // a notification failure must never fail the comment write.
    void this.workItemsService
      .notifyCommentAdded(actor, workItemId, mentionedUserIds)
      .catch(() => undefined);
    return comment;
  }

  async updateComment(actor: JwtPayload, commentId: string, body: string): Promise<Comment> {
    const comment = await this.commentRepo.findById(commentId);
    if (!comment || comment.workspaceId !== actor.workspaceId || comment.deletedAt) {
      throw new NotFoundException('COMMENT_NOT_FOUND', 'Comment not found');
    }
    if (comment.authorId !== actor.sub) {
      throw new PreconditionFailedException(
        'COMMENT_NOT_OWNED',
        'You can only edit your own comments',
      );
    }
    await this.assertCanCollaborate(actor, comment.workItemId);
    return this.commentRepo.update(commentId, body);
  }

  async deleteComment(actor: JwtPayload, commentId: string): Promise<void> {
    const comment = await this.commentRepo.findById(commentId);
    if (!comment || comment.workspaceId !== actor.workspaceId || comment.deletedAt) {
      throw new NotFoundException('COMMENT_NOT_FOUND', 'Comment not found');
    }
    if (comment.authorId !== actor.sub) {
      throw new PreconditionFailedException(
        'COMMENT_NOT_OWNED',
        'You can only delete your own comments',
      );
    }
    await this.assertCanCollaborate(actor, comment.workItemId);
    await this.commentRepo.softDelete(commentId);
  }

  // ── Attachments ───────────────────────────────────────────────────────────

  async listAttachments(actor: JwtPayload, workItemId: string): Promise<Attachment[]> {
    return this.attachmentRepo.listByWorkItem(workItemId, actor.workspaceId);
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
    // Same authorization seam as createComment: the target work item must exist
    // in the actor's workspace and the actor must hold work_item:edit on its
    // project. Without this an attachment could be stapled to a work item in
    // another workspace/project (tenant-isolation leak).
    await this.assertCanCollaborate(actor, workItemId);
    const attachment = await this.attachmentRepo.create({
      id: uuidv7(),
      workspaceId: actor.workspaceId,
      workItemId,
      uploadedBy: actor.sub,
      ...input,
    });
    this.logger.log({ attachmentId: attachment.id, workItemId }, 'Attachment created');
    return attachment;
  }

  async deleteAttachment(actor: JwtPayload, attachmentId: string): Promise<void> {
    const attachment = await this.attachmentRepo.findById(attachmentId);
    if (!attachment || attachment.workspaceId !== actor.workspaceId || attachment.deletedAt) {
      throw new NotFoundException('ATTACHMENT_NOT_FOUND', 'Attachment not found');
    }
    await this.attachmentRepo.softDelete(attachmentId);
  }
}
