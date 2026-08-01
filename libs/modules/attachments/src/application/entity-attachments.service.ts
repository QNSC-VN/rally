import { Inject, Injectable, Logger } from '@nestjs/common';
import { uuidv7 } from 'uuidv7';
import {
  NotFoundException,
  PermissionDeniedException,
  PreconditionFailedException,
} from '@platform';
import type { JwtPayload } from '@platform';
import { PERMISSION, permissionGrants } from '@shared-kernel';
import { AccessService } from '@modules/access';
import { ActivityLogger } from '@modules/activity';
import { AttachmentsService } from './attachments.service';
import { ENTITY_ATTACHMENT_POLICY } from '../domain/attachment-policy';
import {
  ATTACHMENT_REPOSITORY,
  type IAttachmentRepository,
} from '../domain/ports/attachment.repository';
import type { AttachmentRef, EntityAttachment } from '../domain/attachment.types';

/**
 * Attachment mechanics for ANY entity that can own files — the part that was previously
 * inlined in `WorkItemsService` and is identical for a portfolio item.
 *
 * The split follows the rule this module already states: mechanics live here, ROUTES and
 * AUTHORIZATION stay with the owning context. So this service never resolves a permission
 * code from an entity type and never loads a work item or a portfolio item. Its callers
 * (`WorkItemsService`, `PortfolioAttachmentsController`) prove the subject exists, prove the
 * actor may touch it, and pass the resolved `projectId` in for the activity log.
 *
 * That is deliberate rather than lazy: an `entityType → permission` map inside here would be
 * exactly the "owner-type registry lookup" `AttachmentsModule`'s own doc comment warns
 * against, and it is where cross-entity authorization bugs hide.
 *
 * The one authorization decision that DOES live here is the delete-owner rule — only the
 * uploader or a workspace admin may remove a file. That rule is about the FILE, not about the
 * entity it hangs off, so it is the same rule everywhere and belongs in one place.
 */
@Injectable()
export class EntityAttachmentsService {
  private readonly logger = new Logger(EntityAttachmentsService.name);

  constructor(
    @Inject(ATTACHMENT_REPOSITORY) private readonly links: IAttachmentRepository,
    private readonly attachments: AttachmentsService,
    private readonly accessService: AccessService,
    private readonly activity: ActivityLogger,
  ) {}

  async list(actor: JwtPayload, ref: AttachmentRef): Promise<EntityAttachment[]> {
    return this.links.listByEntity(ref, actor.workspaceId);
  }

  async presign(
    actor: JwtPayload,
    ref: AttachmentRef,
    input: { filename: string; mimeType: string; sizeBytes: number; checksumSha256: string },
  ): Promise<{ attachmentId: string; uploadUrl: string; requiredHeaders: Record<string, string> }> {
    const current = await this.links.countByEntity(ref, actor.workspaceId);
    const { fileId, uploadUrl, requiredHeaders } = await this.attachments.presign(
      actor,
      ENTITY_ATTACHMENT_POLICY,
      input,
      current,
    );
    return { attachmentId: fileId, uploadUrl, requiredHeaders };
  }

  async confirm(
    actor: JwtPayload,
    ref: AttachmentRef,
    attachmentId: string,
    projectId: string,
  ): Promise<EntityAttachment> {
    // Verifies the object landed and matches the declared size + checksum.
    const file = await this.attachments.confirm(actor, attachmentId, ENTITY_ATTACHMENT_POLICY);

    // Re-check the quota at confirm time: presign only reserved a row, and N concurrent
    // presigns could each have passed the check against the same count. This is the point
    // where the file becomes visible, so it is the point that has to hold the limit.
    const current = await this.links.countByEntity(ref, actor.workspaceId);
    if (current >= (ENTITY_ATTACHMENT_POLICY.maxPerOwner ?? Infinity)) {
      await this.attachments.softDelete(attachmentId);
      throw new PreconditionFailedException(
        'ATTACHMENT_LIMIT_EXCEEDED',
        `This item already has the maximum of ${ENTITY_ATTACHMENT_POLICY.maxPerOwner} attachments`,
      );
    }

    await this.links.link({
      entityType: ref.entityType,
      entityId: ref.entityId,
      fileId: attachmentId,
      workspaceId: actor.workspaceId,
      attachedBy: actor.sub,
    });

    void this.activity.logSafe([
      {
        id: uuidv7(),
        workspaceId: actor.workspaceId,
        projectId,
        contextId: ref.entityId,
        entityType: 'attachment',
        entityId: attachmentId,
        actorId: actor.sub,
        action: 'attachment.uploaded',
        changes: null,
        metadata: { filename: file.filename },
      },
    ]);
    this.logger.log({ ...ref, attachmentId, filename: file.filename }, 'Attachment confirmed');

    return {
      id: file.id,
      entityType: ref.entityType,
      entityId: ref.entityId,
      workspaceId: actor.workspaceId,
      filename: file.filename,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
      uploadedBy: file.uploadedBy,
      createdAt: file.createdAt,
    };
  }

  async downloadUrl(
    actor: JwtPayload,
    ref: AttachmentRef,
    attachmentId: string,
  ): Promise<{ downloadUrl: string }> {
    // Scoped to the ENTITY, not just the workspace: without this a viewer of item A could
    // mint a URL for an attachment on item B in a project they cannot see.
    const link = await this.links.findByEntityAndFile(ref, attachmentId, actor.workspaceId);
    if (!link) throw new NotFoundException('ATTACHMENT_NOT_FOUND', 'Attachment not found');

    const { url } = await this.attachments.getDownloadUrl(
      actor,
      attachmentId,
      ENTITY_ATTACHMENT_POLICY,
    );
    return { downloadUrl: url };
  }

  async delete(
    actor: JwtPayload,
    ref: AttachmentRef,
    attachmentId: string,
    projectId: string,
  ): Promise<void> {
    const link = await this.links.findByEntityAndFile(ref, attachmentId, actor.workspaceId);
    if (!link) throw new NotFoundException('ATTACHMENT_NOT_FOUND', 'Attachment not found');

    const isAdmin = permissionGrants(
      await this.accessService.getWorkspacePermissions(actor.sub, actor.workspaceId),
      PERMISSION.WORKSPACE_EDIT,
    );
    if (!isAdmin && link.uploadedBy !== actor.sub) {
      throw new PermissionDeniedException(
        'ATTACHMENT_NOT_OWNER',
        'Only the uploader or a workspace admin may delete this attachment',
      );
    }

    await this.links.unlink(ref, attachmentId, actor.workspaceId);
    // Soft-delete the file too. The object itself is removed by the worker reaper, which is
    // the only place that can see whether some other link row still references it.
    await this.attachments.softDelete(attachmentId);

    void this.activity.logSafe([
      {
        id: uuidv7(),
        workspaceId: actor.workspaceId,
        projectId,
        contextId: ref.entityId,
        entityType: 'attachment',
        entityId: attachmentId,
        actorId: actor.sub,
        action: 'attachment.deleted',
        changes: null,
        metadata: { filename: link.filename },
      },
    ]);
    this.logger.log({ ...ref, attachmentId, filename: link.filename }, 'Attachment deleted');
  }
}
