import { Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { InjectDrizzle } from '@platform';
import type { DrizzleDB } from '@platform';
import { files } from '../../../../../../db/schema/storage';
import type { StoredFile, CreateFileInput } from '../../domain/file.types';
import type { IFileRepository } from '../../domain/ports/file.repository';

@Injectable()
export class FileDrizzleRepository implements IFileRepository {
  constructor(@InjectDrizzle() private readonly db: DrizzleDB) {}

  async findById(id: string, workspaceId: string): Promise<StoredFile | null> {
    const rows = await this.db
      .select()
      .from(files)
      .where(and(eq(files.id, id), eq(files.workspaceId, workspaceId), isNull(files.deletedAt)))
      .limit(1);
    return rows[0] ?? null;
  }

  async create(input: CreateFileInput): Promise<StoredFile> {
    const rows = await this.db
      .insert(files)
      .values({
        id: input.id,
        workspaceId: input.workspaceId,
        storageKey: input.storageKey,
        filename: input.filename,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        checksumSha256: input.checksumSha256,
        visibility: input.visibility,
        uploadedBy: input.uploadedBy,
        status: 'pending',
      })
      .returning();
    return rows[0];
  }

  async confirm(id: string, checksumSha256: string | null): Promise<StoredFile> {
    const rows = await this.db
      .update(files)
      .set({
        status: 'completed',
        confirmedAt: new Date(),
        ...(checksumSha256 ? { checksumSha256 } : {}),
      })
      .where(eq(files.id, id))
      .returning();
    return rows[0];
  }

  async softDelete(id: string): Promise<void> {
    await this.db.update(files).set({ deletedAt: new Date() }).where(eq(files.id, id));
  }
}
