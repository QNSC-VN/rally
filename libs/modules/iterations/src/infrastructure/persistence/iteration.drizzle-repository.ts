import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, ilike, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import { InjectDrizzle, buildPageResult, keysetCondition } from '@platform';
import type { DrizzleDB, CursorPayload, PagedResult } from '@platform';
import { iterations, tasks } from '../../../../../../db/schema/work';
import type {
  Iteration,
  IterationOption,
  IterationReference,
  CreateIterationInput,
  UpdateIterationInput,
  IterationFilters,
} from '../../domain/iteration.types';
import { IIterationRepository } from '../../domain/ports/iteration.repository';
import { timeboxGroupIdFor } from '../../domain/timebox-group';

@Injectable()
export class IterationDrizzleRepository implements IIterationRepository {
  constructor(@InjectDrizzle() private readonly db: DrizzleDB) {}

  async findById(id: string): Promise<Iteration | null> {
    const rows = await this.db.select().from(iterations).where(eq(iterations.id, id)).limit(1);
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
      conditions.push(keysetCondition(iterations.createdAt, iterations.id, cursor));
    }

    const rows = await this.db
      .select()
      .from(iterations)
      .where(and(...conditions))
      .orderBy(asc(iterations.createdAt), asc(iterations.id))
      .limit(limit + 1);

    return buildPageResult(rows as Iteration[], limit, (i) => [i.createdAt.toISOString()]);
  }

  /**
   * Sum of child task estimate_hours per iteration (IT-001). One grouped query
   * over the iteration ids on the current page — avoids a per-row rollup.
   * Tasks carry their parent's iteration (mirror), so iteration_id is the scope.
   */
  async taskEstimatesByIteration(
    workspaceId: string,
    iterationIds: string[],
  ): Promise<Map<string, number>> {
    if (iterationIds.length === 0) return new Map();
    const rows = await this.db
      .select({
        iterationId: tasks.iterationId,
        total: sql<string>`coalesce(sum(${tasks.estimateHours}), 0)`,
      })
      .from(tasks)
      .where(
        and(
          eq(tasks.workspaceId, workspaceId),
          inArray(tasks.iterationId, iterationIds),
          isNull(tasks.deletedAt),
        ),
      )
      .groupBy(tasks.iterationId);
    return new Map(rows.map((r) => [r.iterationId as string, Number(r.total)]));
  }

  async nextKeyNumber(projectId: string, workspaceId: string): Promise<number> {
    // MAX(existing numeric suffix) + 1, not count(*) + 1: iterations can be
    // hard-deleted (see delete() below), so count() under-reports once any
    // iteration is gone and reissues a key a surviving row still holds —
    // exactly the uq_iterations_key collision this was meant to prevent.
    // Still not airtight under concurrent creates (two requests can read the
    // same MAX before either commits), so createIteration retries on the
    // unique-constraint violation this query can't fully rule out alone.
    // substring(... from '[0-9]+$'), not a \d regex: Drizzle's sql template
    // silently drops a bare backslash before it reaches Postgres (verified via
    // query.toSQL() — '(\d+)$' arrived as the literal 3-char pattern '(d+)$'),
    // so \d-based patterns quietly match nothing and this always computed 0.
    // The POSIX character class needs no backslash and sidesteps that entirely.
    const rows = await this.db
      .select({
        n: sql<number>`COALESCE(MAX(substring(${iterations.iterationKey} from '[0-9]+$')::int), 0)::int`,
      })
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
        timeboxGroupId: timeboxGroupIdFor(input.projectId, input.startDate, input.endDate),
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

  /**
   * The team predicate both compact feeds share: the team's OWN timeboxes PLUS the project's
   * shared ones.
   *
   * `iterations.team_id` is optional in this product — the timebox says WHICH window, the work
   * says whose it is — so a project may run one shared sprint every team works inside (195 of 206
   * local iterations name no team). A plain `= teamId` drops exactly those, because SQL equality
   * never matches NULL, and a team-scoped picker then comes back EMPTY. This is the server half of
   * `iterationsInScope` and the same rule as reporting's `teamOrSharedTimebox`.
   *
   * Note `listByProject` (the RECORD grid) deliberately keeps its strict `= teamId`: that is an
   * administrative filter over a grid, not a picker feed, and narrowing it is what the reader asked
   * for.
   */
  private teamOrSharedTimebox(teamId: string): SQL {
    return or(isNull(iterations.teamId), eq(iterations.teamId, teamId))!;
  }

  /**
   * ELIGIBILITY, and eligibility does NOT depend on STATE (P6-VEL-004, BA retest 2026-08-17).
   *
   * This query used to carry `inArray(state, ['planning', 'committed'])`, so an ACCEPTED — closed —
   * iteration was absent from every assignment picker. That made one direction of a documented
   * Velocity behaviour unreachable through the UI: Velocity attributes points by the item's CURRENT
   * iteration (Phase 6/03_Velocity_Chart/SRS.md §4, PHASE6_REPORTS_BUSINESS_AND_DATA_CONTRACT §5.2),
   * so moving US-2 OUT of a finished sprint correctly dropped its bar from 8 to 3 — and nothing could
   * put it back, because the selector no longer offered the sprint it came from. A frozen bar is not
   * what the SRS describes; a one-way move is worse than either.
   *
   * The predicate is now exactly what `WorkItemsService.assertIterationAssignable` enforces on the
   * WRITE: same project, and a team-scoped timebox only for that team (`findIterationScope` selects
   * `project_id` and `team_id` and no state, so the write path is state-blind BY CONSTRUCTION). The
   * feed's contract — "a picker can never be offered a target the server would refuse" — now also
   * holds in the other direction: it no longer withholds a target the server accepts.
   *
   * A closed timebox is a legal destination in the domain too: `autoAcceptIterationIfComplete` only
   * ever moves `planning|committed → accepted` and never reverses (BUSINESS_BASELINE:12), so joining
   * an accepted iteration cannot flip anything, and the item's own Schedule State, Flow State and
   * `accepted_date` are untouched by an iteration change.
   *
   * WHAT REMAINS of the split: the two feeds now share a POPULATION and differ only in PROJECTION —
   * `listReferences` also returns `team_id`, which `iterationsInScope` needs. Kept as two routes
   * rather than collapsed: the eligibility question is still a distinct question (the write rule may
   * narrow again, e.g. if the BA ever refuses assigning into an archived timebox), and the SPA's
   * generated client is committed, so deleting a route is a codegen change. Do NOT re-add a state
   * predicate here without a BA ruling that reverses P6-VEL-004.
   */
  async listAssignmentOptions(
    projectId: string,
    workspaceId: string,
    teamId?: string,
  ): Promise<IterationOption[]> {
    const conditions: SQL[] = [
      eq(iterations.projectId, projectId),
      eq(iterations.workspaceId, workspaceId),
    ];
    if (teamId) conditions.push(this.teamOrSharedTimebox(teamId));

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
      .orderBy(desc(iterations.startDate), asc(iterations.name), asc(iterations.id));

    return rows;
  }

  async listReferences(
    projectId: string,
    workspaceId: string,
    teamId?: string,
  ): Promise<IterationReference[]> {
    const conditions: SQL[] = [
      eq(iterations.projectId, projectId),
      eq(iterations.workspaceId, workspaceId),
    ];
    // No state predicate, deliberately: a filter, a label and a report scope picker must all be
    // able to name an ACCEPTED or finished timebox.
    if (teamId) conditions.push(this.teamOrSharedTimebox(teamId));

    const rows = await this.db
      .select({
        id: iterations.id,
        name: iterations.name,
        iterationKey: iterations.iterationKey,
        state: iterations.state,
        startDate: iterations.startDate,
        endDate: iterations.endDate,
        teamId: iterations.teamId,
      })
      .from(iterations)
      .where(and(...conditions))
      .orderBy(desc(iterations.startDate), asc(iterations.name), asc(iterations.id));

    return rows;
  }
}
