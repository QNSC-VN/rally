import { and, eq, isNull, sql, type SQL } from 'drizzle-orm';
import { capacityPlanAllocations, workItems } from '../../../../../../db/schema/work';
import { completedScheduleStatesSql } from '../../../../../../db/schema/enums';

/**
 * The child-work predicate that every capacity number is built from.
 *
 * RALLY'S RULE, not ours (Broadcom TechDocs, "View Capacity Plan Details"): "If a
 * portfolio item includes allocated points/counts, the Project and Release fields in the
 * story must match the plan for that story to be included in the Rollup calculation" —
 * and the identical sentence for Complete.
 *
 * Two consequences that are easy to get wrong:
 *
 *  1. The RELEASE filter is essential. A Feature's children may span several releases, so
 *     counting all of them would inflate every plan that happens to touch that Feature.
 *     Only the children actually in the release being planned belong to this plan.
 *
 *  2. The per-TEAM split comes from the same rule. Rally's data model treats a Project as
 *     the team, so "the story's Project must match" is Rally's way of attributing a story
 *     to a team. Our model separates the two, so the faithful translation is
 *     `work_items.team_id`. This is what keeps a Feature SHARED between teams from being
 *     counted once per team: each team sees only its own stories, and the plan total is
 *     the sum without duplication.
 *
 * `teamId` null means "do not constrain by team" — used for the plan-wide totals and for
 * the Unallocated bucket, which has no team to attribute to.
 */
export function childWorkPredicate(args: {
  projectId: string;
  releaseId: string;
  teamId?: string | null;
  /** Restrict to one Feature, for a per-allocation figure. */
  portfolioItemId?: string;
  /** Restrict to the Features allocated to a team in this plan. */
  planId?: string;
}): SQL {
  const conditions: SQL[] = [
    eq(workItems.projectId, args.projectId),
    eq(workItems.releaseId, args.releaseId),
    isNull(workItems.deletedAt),
  ];

  if (args.teamId) conditions.push(eq(workItems.teamId, args.teamId));

  if (args.portfolioItemId) {
    conditions.push(eq(workItems.featureId, args.portfolioItemId));
  } else if (args.planId) {
    // The Features this team has committed to in this plan. Written as a subquery rather
    // than a join so the aggregate stays one row per group.
    const teamFilter = args.teamId
      ? sql`and ${capacityPlanAllocations.teamId} = ${args.teamId}`
      : sql`and ${capacityPlanAllocations.teamId} is not null`;
    conditions.push(
      sql`${workItems.featureId} in (
        select ${capacityPlanAllocations.portfolioItemId}
        from ${capacityPlanAllocations}
        where ${capacityPlanAllocations.planId} = ${args.planId} ${teamFilter}
      )`,
    );
  }

  return and(...conditions) as SQL;
}

/**
 * `complete` and `rollup` for one scope, as scalar subqueries.
 *
 * Complete uses COMPLETED_SCHEDULE_STATES (completed, accepted, release) while the
 * Portfolio's Percent Done uses ACCEPTED_SCHEDULE_STATES. That difference is deliberate and
 * documented as the D1 distinction in `db/schema/enums.ts`: a capacity plan reports what a
 * team has FINISHED, the portfolio reports what the business has SIGNED OFF.
 */
export function metricSubqueries(where: SQL) {
  return {
    rollup: sql<string>`(
      select coalesce(sum(${workItems.storyPoints}), 0)
      from ${workItems}
      where ${where}
    )`,
    complete: sql<string>`(
      select coalesce(sum(${workItems.storyPoints}) filter (
        where ${workItems.scheduleState} in (${completedScheduleStatesSql()})
      ), 0)
      from ${workItems}
      where ${where}
    )`,
  };
}
