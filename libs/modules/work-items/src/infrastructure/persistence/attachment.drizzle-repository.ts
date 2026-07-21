import { Injectable } from '@nestjs/common';
import { and, count, eq, isNull } from 'drizzle-orm';
import { InjectDrizzle } from '@platform';
import type { DrizzleDB } from '@platform';
import { workItemAttachments } from '../../../../../../db/schema/work';
import { files } from '../../../../../../db/schema/storage';
import type { WorkItemAttachment } from '../../domain/attachment.types';
import type { IAttachmentRepository } from '../../domain/ports/attachment.repository';

/**
 * Link-table repository. Every query joins storage.files and filters on
 * `status = 'completed'` + `deleted_at IS NULL`, so a presigned-but-unconfirmed
 * or soft-deleted file can never appear in a listing or count against quota.
 */
@Injectable()
export class AttachmentDrizzleRepository implements IAttachmentRepository {
  constructor(@InjectDrizzle() private readonly db: DrizzleDB) {}

  private static readonly projection = {
    id: files.id,
    workItemId: workItemAttachments.workItemId,
    workspaceId: workItemAttachments.workspaceId,
    filename: files.filename,
    mimeType: files.mimeType,
    sizeBytes: files.sizeBytes,
    uploadedBy: files.uploadedBy,
    createdAt: workItemAttachments.createdAt,
  };

  async listByWorkItem(workItemId: string, workspaceId: string): Promise<WorkItemAttachment[]> {
    return this.db
      .select(AttachmentDrizzleRepository.projection)
      .from(workItemAttachments)
      .innerJoin(files, eq(files.id, workItemAttachments.fileId))
      .where(
        and(
          eq(workItemAttachments.workItemId, workItemId),
          eq(workItemAttachments.workspaceId, workspaceId),
          eq(files.status, 'completed'),
          isNull(files.deletedAt),
        ),
      )
      .orderBy(workItemAttachments.createdAt);
  }

  async countByWorkItem(workItemId: string, workspaceId: string): Promise<number> {
    const [{ cnt }] = await this.db
      .select({ cnt: count() })
      .from(workItemAttachments)
      .innerJoin(files, eq(files.id, workItemAttachments.fileId))
      .where(
        and(
          eq(workItemAttachments.workItemId, workItemId),
          eq(workItemAttachments.workspaceId, workspaceId),
          eq(files.status, 'completed'),
          isNull(files.deletedAt),
        ),
      );
    return Number(cnt);
  }

  async findByWorkItemAndFile(
    workItemId: string,
    fileId: string,
    workspaceId: string,
  ): Promise<WorkItemAttachment | null> {
    const rows = await this.db
      .select(AttachmentDrizzleRepository.projection)
      .from(workItemAttachments)
      .innerJoin(files, eq(files.id, workItemAttachments.fileId))
      .where(
        and(
          eq(workItemAttachments.workItemId, workItemId),
          eq(workItemAttachments.fileId, fileId),
          eq(workItemAttachments.workspaceId, workspaceId),
          isNull(files.deletedAt),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async link(input: {
    workItemId: string;
    fileId: string;
    workspaceId: string;
    attachedBy: string;
  }): Promise<void> {
    await this.db.insert(workItemAttachments).values(input).onConflictDoNothing();
  }

  async unlink(workItemId: string, fileId: string, workspaceId: string): Promise<void> {
    await this.db
      .delete(workItemAttachments)
      .where(
        and(
          eq(workItemAttachments.workItemId, workItemId),
          eq(workItemAttachments.fileId, fileId),
          eq(workItemAttachments.workspaceId, workspaceId),
        ),
      );
  }
}
