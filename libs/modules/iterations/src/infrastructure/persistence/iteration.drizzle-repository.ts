import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, ilike, inArray, lt, or, sql, type SQL } from 'drizzle-orm';
import { InjectDrizzle, buildPageResult } from '@platform';
import type { DrizzleDB, CursorPayload, PagedResult } from '@platform';
import { iterations } from '../../../../../../db/schema/work';
import type {
  Iteration,
  IterationOption,
  CreateIterationInput,
  UpdateIterationInput,
  IterationFilters,
} from '../../domain/iteration.types';
import { IIterationRepository } from '../../domain/ports/iteration.repository';

@Injectable()
export class IterationDrizzleRepository implements IIterationRepository {
  constructor(@InjectDrizzle() private readonly db: DrizzleDB) {}

  async findById(id: string): Promise<Iteration | null> {
    const rows = await this.db.select().from(iterations).where(eq(iterations.id, id)).limit(1);
    return rows[0] ?? null;
  }

  async findCommitted(projectId: string): Promise<Iteration | null> {
    const rows = await this.db
      .select()
      .from(iterations)
      .where(and(eq(iterations.projectId, projectId), eq(iterations.state, 'committed')))
      .limit(1);
    return rows[0] ?? null;
  }

  async listByProject(
    projectId: string,
    workspaceId: string,
    filters: IterationFilters,
    { limit, cursor }: { limit: number; cursor: CursorPayload | null },
  ): Promise<PagedResult<Iteration>> {
    const conditions: SQL[] = [
      eq(iterations.projectId, projectId),
      eq(iterations.workspaceId, workspaceId),
    ];

    if (filters.teamId) conditions.push(eq(iterations.teamId, filters.teamId));
    if (filters.state) conditions.push(eq(iterations.state, filters.state));
    if (filters.q) {
      const term = `%${filters.q}%`;
      conditions.push(or(ilike(iterations.name, term), ilike(iterations.theme, term))!);
    }

    if (cursor) {
      conditions.push(lt(iterations.createdAt, new Date(cursor.k[0] as string)));
    }

    const rows = await this.db
      .select()
      .from(iterations)
      .where(and(...conditions))
      .orderBy(asc(iterations.createdAt))
      .limit(limit + 1);

    return buildPageResult(rows as Iteration[], limit, (i) => [i.createdAt.toISOString()]);
  }

  async nextKeyNumber(projectId: string, workspaceId: string): Promise<number> {
    // Count existing iterations for the project; next number = count + 1.
    // Uniqueness is enforced by uq_iterations_key; on collision the caller retries.
    const rows = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(iterations)
      .where(and(eq(iterations.projectId, projectId), eq(iterations.workspaceId, workspaceId)));
    return (rows[0]?.n ?? 0) + 1;
  }

  async create(input: CreateIterationInput): Promise<Iteration> {
    const rows = await this.db
      .insert(iterations)
      .values({
        id: input.id,
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        teamId: input.teamId ?? null,
        iterationKey: input.iterationKey ?? null,
        name: input.name,
        goal: input.goal,
        theme: input.theme,
        notes: input.notes,
        state: input.state ?? 'planning',
        plannedVelocity: input.plannedVelocity ?? null,
        startDate: input.startDate,
        endDate: input.endDate,
      })
      .returning();
    return rows[0];
  }

  async update(id: string, input: UpdateIterationInput): Promise<Iteration> {
    const rows = await this.db
      .update(iterations)
      .set({
        ...(input.name !== undefined && { name: input.name }),
        ...(input.goal !== undefined && { goal: input.goal }),
        ...(input.theme !== undefined && { theme: input.theme }),
        ...(input.notes !== undefined && { notes: input.notes }),
        ...(input.teamId !== undefined && { teamId: input.teamId }),
        ...(input.state !== undefined && { state: input.state }),
        ...(input.plannedVelocity !== undefined && { plannedVelocity: input.plannedVelocity }),
        ...(input.startDate !== undefined && { startDate: input.startDate }),
        ...(input.endDate !== undefined && { endDate: input.endDate }),
        ...(input.completedAt !== undefined && { completedAt: input.completedAt }),
        updatedAt: new Date(),
      })
      .where(eq(iterations.id, id))
      .returning();
    return rows[0];
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(iterations).where(eq(iterations.id, id));
  }

  async listAssignmentOptions(
    projectId: string,
    workspaceId: string,
    teamId?: string,
  ): Promise<IterationOption[]> {
    const conditions: SQL[] = [
      eq(iterations.projectId, projectId),
      eq(iterations.workspaceId, workspaceId),
      inArray(iterations.state, ['planning', 'committed']),
    ];
    if (teamId) conditions.push(eq(iterations.teamId, teamId));

    const rows = await this.db
      .select({
        id: iterations.id,
        name: iterations.name,
        iterationKey: iterations.iterationKey,
        startDate: iterations.startDate,
        endDate: iterations.endDate,
        state: iterations.state,
      })
      .from(iterations)
      .where(and(...conditions))
      .orderBy(desc(iterations.startDate), asc(iterations.name));

    return rows;
  }
}
