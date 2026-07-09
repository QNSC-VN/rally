import { Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { InjectDrizzle } from '@platform';
import type { DrizzleDB } from '@platform';
import { attachments } from '../../../../../../db/schema/work';
import type { Attachment, CreateAttachmentInput } from '../../domain/collaboration.types';
import { IAttachmentRepository } from '../../domain/ports/attachment.repository';

@Injectable()
export class AttachmentDrizzleRepository implements IAttachmentRepository {
  constructor(@InjectDrizzle() private readonly db: DrizzleDB) {}

  async findById(id: string): Promise<Attachment | null> {
    const rows = await this.db.select().from(attachments).where(eq(attachments.id, id)).limit(1);
    return (rows[0]) ?? null;
  }

  async listByWorkItem(workItemId: string, workspaceId: string): Promise<Attachment[]> {
    const rows = await this.db
      .select()
      .from(attachments)
      .where(
        and(
          eq(attachments.workItemId, workItemId),
          eq(attachments.workspaceId, workspaceId),
          isNull(attachments.deletedAt),
        ),
      );
    return rows;
  }

  async create(input: CreateAttachmentInput): Promise<Attachment> {
    const rows = await this.db
      .insert(attachments)
      .values({
        id: input.id,
        workspaceId: input.workspaceId,
        workItemId: input.workItemId,
        uploadedBy: input.uploadedBy,
        filename: input.filename,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        storageKey: input.storageKey,
      })
      .returning();
    return rows[0];
  }

  async softDelete(id: string): Promise<void> {
    await this.db.update(attachments).set({ deletedAt: new Date() }).where(eq(attachments.id, id));
  }
}
