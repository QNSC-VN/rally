import { Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { InjectDrizzle } from '@platform';
import type { DrizzleDB } from '@platform';
import { comments } from '../../../../../../db/schema/work';
import type { Comment, CreateCommentInput } from '../../domain/collaboration.types';
import { ICommentRepository } from '../../domain/ports/comment.repository';

@Injectable()
export class CommentDrizzleRepository implements ICommentRepository {
  constructor(@InjectDrizzle() private readonly db: DrizzleDB) {}

  async findById(id: string): Promise<Comment | null> {
    const rows = await this.db.select().from(comments).where(eq(comments.id, id)).limit(1);
    return (rows[0] as Comment | undefined) ?? null;
  }

  async listByWorkItem(workItemId: string, tenantId: string): Promise<Comment[]> {
    const rows = await this.db
      .select()
      .from(comments)
      .where(
        and(
          eq(comments.workItemId, workItemId),
          eq(comments.tenantId, tenantId),
          isNull(comments.deletedAt),
        ),
      );
    return rows as Comment[];
  }

  async create(input: CreateCommentInput): Promise<Comment> {
    const rows = await this.db
      .insert(comments)
      .values({
        id: input.id,
        tenantId: input.tenantId,
        workItemId: input.workItemId,
        authorId: input.authorId,
        body: input.body,
        parentId: input.parentId,
      })
      .returning();
    return rows[0] as Comment;
  }

  async update(id: string, body: string): Promise<Comment> {
    const rows = await this.db
      .update(comments)
      .set({ body, isEdited: true, editedAt: new Date(), updatedAt: new Date() })
      .where(eq(comments.id, id))
      .returning();
    return rows[0] as Comment;
  }

  async softDelete(id: string): Promise<void> {
    await this.db
      .update(comments)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(comments.id, id));
  }
}
