import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { InjectDrizzle } from '@platform';
import type { DrizzleDB } from '@platform';
import { workItemRelations, workItems } from '../../../../../../db/schema/work';
import type { WorkItemRelationType } from '../../../../../../db/schema/enums';
import { IWorkItemRelationRepository } from '../../domain/ports/work-item-relation.repository';
import {
  RELATION_INVERSE,
  RELATION_LABELS,
  type WorkItemRelation,
  type WorkItemRelationView,
  type CreateWorkItemRelationInput,
} from '../../domain/work-item-relation.types';

@Injectable()
export class WorkItemRelationDrizzleRepository implements IWorkItemRelationRepository {
  constructor(@InjectDrizzle() private readonly db: DrizzleDB) {}

  async listForItem(itemId: string, workspaceId: string): Promise<WorkItemRelationView[]> {
    const rel = workItemRelations;
    const other = alias(workItems, 'other');

    // Outbound: this item is the source → show the forward label; other = target.
    const outbound = await this.db
      .select({
        id: rel.id,
        relationType: rel.relationType,
        createdAt: rel.createdAt,
        otherId: other.id,
        otherKey: other.itemKey,
        otherTitle: other.title,
        otherType: other.type,
        otherScheduleState: other.scheduleState,
      })
      .from(rel)
      .innerJoin(other, eq(other.id, rel.targetItemId))
      .where(and(eq(rel.sourceItemId, itemId), eq(rel.workspaceId, workspaceId)));

    // Inbound: this item is the target → show the inverse label; other = source.
    const inbound = await this.db
      .select({
        id: rel.id,
        relationType: rel.relationType,
        createdAt: rel.createdAt,
        otherId: other.id,
        otherKey: other.itemKey,
        otherTitle: other.title,
        otherType: other.type,
        otherScheduleState: other.scheduleState,
      })
      .from(rel)
      .innerJoin(other, eq(other.id, rel.sourceItemId))
      .where(and(eq(rel.targetItemId, itemId), eq(rel.workspaceId, workspaceId)));

    const views: WorkItemRelationView[] = [
      ...outbound.map((r) => this.toView(r, 'outbound')),
      ...inbound.map((r) => this.toView(r, 'inbound')),
    ];
    // Stable order: newest first.
    return views.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  private toView(
    r: {
      id: string;
      relationType: WorkItemRelationType;
      createdAt: Date;
      otherId: string;
      otherKey: string;
      otherTitle: string;
      otherType: string;
      otherScheduleState: string;
    },
    direction: 'outbound' | 'inbound',
  ): WorkItemRelationView {
    const token = direction === 'outbound' ? r.relationType : RELATION_INVERSE[r.relationType];
    return {
      id: r.id,
      relationType: r.relationType,
      direction,
      label: RELATION_LABELS[token] ?? token,
      relatedItem: {
        id: r.otherId,
        itemKey: r.otherKey,
        title: r.otherTitle,
        type: r.otherType,
        scheduleState: r.otherScheduleState,
      },
      createdAt: r.createdAt,
    };
  }

  async exists(
    sourceItemId: string,
    targetItemId: string,
    relationType: WorkItemRelationType,
    workspaceId: string,
  ): Promise<boolean> {
    const rows = await this.db
      .select({ id: workItemRelations.id })
      .from(workItemRelations)
      .where(
        and(
          eq(workItemRelations.sourceItemId, sourceItemId),
          eq(workItemRelations.targetItemId, targetItemId),
          eq(workItemRelations.relationType, relationType),
          eq(workItemRelations.workspaceId, workspaceId),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  async create(input: CreateWorkItemRelationInput, workspaceId: string): Promise<WorkItemRelation> {
    const [row] = await this.db
      .insert(workItemRelations)
      .values({
        workspaceId,
        sourceItemId: input.sourceItemId,
        targetItemId: input.targetItemId,
        relationType: input.relationType,
        createdBy: input.createdBy,
      })
      .returning();
    return row;
  }

  async findById(id: string, workspaceId: string): Promise<WorkItemRelation | null> {
    const rows = await this.db
      .select()
      .from(workItemRelations)
      .where(and(eq(workItemRelations.id, id), eq(workItemRelations.workspaceId, workspaceId)))
      .limit(1);
    return rows[0] ?? null;
  }

  async delete(id: string, workspaceId: string): Promise<void> {
    await this.db
      .delete(workItemRelations)
      .where(and(eq(workItemRelations.id, id), eq(workItemRelations.workspaceId, workspaceId)));
  }

  async wouldCreateCycle(
    sourceId: string,
    targetId: string,
    relationType: WorkItemRelationType,
    workspaceId: string,
  ): Promise<boolean> {
    // Load all edges of this type in the workspace and BFS from targetId,
    // following source → target. If we can reach sourceId, adding
    // sourceId → targetId would close a cycle.
    const edges = await this.db
      .select({ from: workItemRelations.sourceItemId, to: workItemRelations.targetItemId })
      .from(workItemRelations)
      .where(
        and(
          eq(workItemRelations.relationType, relationType),
          eq(workItemRelations.workspaceId, workspaceId),
        ),
      );

    const adjacency = new Map<string, string[]>();
    for (const e of edges) {
      const list = adjacency.get(e.from) ?? [];
      list.push(e.to);
      adjacency.set(e.from, list);
    }

    const seen = new Set<string>();
    const queue = [targetId];
    while (queue.length > 0) {
      const current = queue.shift() as string;
      if (current === sourceId) return true;
      if (seen.has(current)) continue;
      seen.add(current);
      for (const next of adjacency.get(current) ?? []) queue.push(next);
    }
    return false;
  }
}
