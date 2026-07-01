import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { InjectDrizzle } from '@platform';
import type { DrizzleDB } from '@platform';
import { labels } from '../../../../../../db/schema/work';
import type { Label, CreateLabelInput, UpdateLabelInput } from '../../domain/label.types';
import { ILabelRepository } from '../../domain/ports/label.repository';

@Injectable()
export class LabelDrizzleRepository implements ILabelRepository {
  constructor(@InjectDrizzle() private readonly db: DrizzleDB) {}

  async findById(id: string): Promise<Label | null> {
    const rows = await this.db.select().from(labels).where(eq(labels.id, id)).limit(1);
    return (rows[0] as Label | undefined) ?? null;
  }

  async listByProject(projectId: string, tenantId: string): Promise<Label[]> {
    const rows = await this.db
      .select()
      .from(labels)
      .where(and(eq(labels.projectId, projectId), eq(labels.tenantId, tenantId)))
      .orderBy(labels.name);
    return rows as Label[];
  }

  async create(input: CreateLabelInput): Promise<Label> {
    const rows = await this.db
      .insert(labels)
      .values({
        id: input.id,
        tenantId: input.tenantId,
        projectId: input.projectId,
        name: input.name,
        color: input.color ?? '#6b7280',
      })
      .returning();
    return rows[0] as Label;
  }

  async update(id: string, input: UpdateLabelInput): Promise<Label> {
    const rows = await this.db
      .update(labels)
      .set({
        ...(input.name !== undefined && { name: input.name }),
        ...(input.color !== undefined && { color: input.color }),
        updatedAt: new Date(),
      })
      .where(eq(labels.id, id))
      .returning();
    return rows[0] as Label;
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(labels).where(eq(labels.id, id));
  }
}
