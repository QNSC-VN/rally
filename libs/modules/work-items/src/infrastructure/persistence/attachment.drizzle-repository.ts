import { Injectable } from '@nestjs/common';
import { and, count, eq, isNull } from 'drizzle-orm';
import { InjectDrizzle } from '@platform';
import type { DrizzleDB } from '@platform';
import { attachments } from '../../../../../../db/schema/work';
import type { Attachment, CreateAttachmentInput } from '../../domain/attachment.types';
import type { IAttachmentRepository } from '../../domain/ports/attachment.repository';

@Injectable()
export class AttachmentDrizzleRepository implements IAttachmentRepository {
  constructor(@InjectDrizzle() private readonly db: DrizzleDB) {}

  async findById(id: string, tenantId: string): Promise<Attachment | null> {
    const rows = await this.db
      .select()
      .from(attachments)
      .where(
        and(eq(attachments.id, id), eq(attachments.tenantId, tenantId), isNull(attachments.deletedAt)),
      )
      .limit(1);
    return (rows[0] as Attachment | undefined) ?? null;
  }

  async listByWorkItem(workItemId: string, tenantId: string): Promise<Attachment[]> {
    const rows = await this.db
      .select()
      .from(attachments)
      .where(
        and(
          eq(attachments.workItemId, workItemId),
          eq(attachments.tenantId, tenantId),
          eq(attachments.status, 'completed'),
          isNull(attachments.deletedAt),
        ),
      )
      .orderBy(attachments.createdAt);
    return rows as Attachment[];
  }

  async countByWorkItem(workItemId: string, tenantId: string): Promise<number> {
    const [{ cnt }] = await this.db
      .select({ cnt: count() })
      .from(attachments)
      .where(
        and(
          eq(attachments.workItemId, workItemId),
          eq(attachments.tenantId, tenantId),
          eq(attachments.status, 'completed'),
          isNull(attachments.deletedAt),
        ),
      );
    return Number(cnt);
  }

  async create(input: CreateAttachmentInput): Promise<Attachment> {
    const rows = await this.db
      .insert(attachments)
      .values({
        id: input.id,
        tenantId: input.tenantId,
        workItemId: input.workItemId,
        uploadedBy: input.uploadedBy,
        filename: input.filename,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        storageKey: input.storageKey,
        status: 'pending',
      })
      .returning();
    return rows[0] as unknown as Attachment;
  }

  async confirm(id: string): Promise<Attachment> {
    const rows = await this.db
      .update(attachments)
      .set({ status: 'completed' })
      .where(eq(attachments.id, id))
      .returning();
    return rows[0] as unknown as Attachment;
  }

  async softDelete(id: string): Promise<Attachment> {
    const rows = await this.db
      .update(attachments)
      .set({ deletedAt: new Date() })
      .where(eq(attachments.id, id))
      .returning();
    return rows[0] as unknown as Attachment;
  }
}
