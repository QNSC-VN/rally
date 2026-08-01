import { roundForDisplay } from './report-scope';

/**
 * Team Capacity roll-up (Team Capacity SRS §3 and §4).
 *
 * A read-only PROJECTION of the same capacity and task-hour sources `Track > Team Status`
 * uses. It must not maintain a separate capacity store, so nothing here writes and the
 * repository reads `member_capacity` + `tasks` — the same tables Team Status reads.
 */

export interface TeamCapacityHours {
  capacityHours: number;
  estimateHours: number;
  todoHours: number;
  actualHours: number;
}

/** A member's capacity row for the selected project/team/iteration. */
export interface CapacityRecord {
  teamId: string;
  teamName: string;
  memberId: string;
  memberName: string;
  capacityHours: number;
}

/** One task in scope, already narrowed. `ownerId` null = unassigned. */
export interface ScopedTaskHours {
  /** Stable task id — the de-duplication key (§8). */
  taskId: string;
  teamId: string;
  teamName: string;
  ownerId: string | null;
  ownerName: string | null;
  estimateHours: number;
  todoHours: number;
  actualHours: number;
}

export interface TeamCapacityMemberRow {
  /** Null for the synthetic `Unassigned` group. */
  id: string | null;
  name: string;
  hours: TeamCapacityHours;
}

export interface TeamCapacityTeamRow {
  id: string;
  name: string;
  totals: TeamCapacityHours;
  members: TeamCapacityMemberRow[];
}

export interface TeamCapacityRollup {
  totals: TeamCapacityHours;
  teams: TeamCapacityTeamRow[];
}

const ZERO: TeamCapacityHours = {
  capacityHours: 0,
  estimateHours: 0,
  todoHours: 0,
  actualHours: 0,
};

/** The label the `Unassigned` group carries when a scoped task has no owner (§4). */
export const UNASSIGNED_LABEL = 'Unassigned';

function add(a: TeamCapacityHours, b: Partial<TeamCapacityHours>): TeamCapacityHours {
  return {
    capacityHours: a.capacityHours + (b.capacityHours ?? 0),
    estimateHours: a.estimateHours + (b.estimateHours ?? 0),
    todoHours: a.todoHours + (b.todoHours ?? 0),
    actualHours: a.actualHours + (b.actualHours ?? 0),
  };
}

function round(h: TeamCapacityHours): TeamCapacityHours {
  return {
    capacityHours: roundForDisplay(h.capacityHours),
    estimateHours: roundForDisplay(h.estimateHours),
    todoHours: roundForDisplay(h.todoHours),
    actualHours: roundForDisplay(h.actualHours),
  };
}

/**
 * Build the Team → Member table.
 *
 * MEMBER INCLUSION IS A UNION, NOT AN INTERSECTION (§4)
 *
 * Members with a capacity record but no tasks stay visible (planned capacity nobody has
 * work for is a planning signal), and task owners with no capacity record are not
 * silently dropped (they show `0h` capacity, which is a data-quality gap — never inferred
 * from their task hours).
 *
 * A person on two Teams appears ONCE INSIDE EACH Team. Their rows are not merged: the
 * report answers "what is this Team committed to", and merging would make one Team's
 * numbers depend on another's.
 *
 * Tasks are de-duplicated by task id before aggregation (§8), which matters for All Teams
 * where the same task can be reached through more than one join path.
 */
export function rollUpTeamCapacity(input: {
  capacities: readonly CapacityRecord[];
  tasks: readonly ScopedTaskHours[];
}): TeamCapacityRollup {
  interface Bucket {
    id: string;
    name: string;
    members: Map<string, TeamCapacityMemberRow>;
  }
  const teams = new Map<string, Bucket>();

  const team = (id: string, name: string): Bucket => {
    const existing = teams.get(id);
    if (existing) return existing;
    const created: Bucket = { id, name, members: new Map() };
    teams.set(id, created);
    return created;
  };

  const member = (bucket: Bucket, key: string, id: string | null, name: string) => {
    const existing = bucket.members.get(key);
    if (existing) return existing;
    const created: TeamCapacityMemberRow = { id, name, hours: { ...ZERO } };
    bucket.members.set(key, created);
    return created;
  };

  // 1. Capacity records first, so a member with capacity and no tasks still has a row.
  for (const record of input.capacities) {
    const bucket = team(record.teamId, record.teamName);
    const row = member(bucket, record.memberId, record.memberId, record.memberName);
    // Additive rather than assigned: the unique index makes one row per
    // (project, team, iteration, member), but summing means a duplicate would show up as
    // a wrong total rather than a silently dropped record.
    row.hours = add(row.hours, { capacityHours: record.capacityHours });
  }

  // 2. Task hours, de-duplicated by task id.
  const seenTasks = new Set<string>();
  for (const task of input.tasks) {
    if (seenTasks.has(task.taskId)) continue;
    seenTasks.add(task.taskId);
    const bucket = team(task.teamId, task.teamName);
    const key = task.ownerId ?? UNASSIGNED_LABEL;
    const row = member(bucket, key, task.ownerId, task.ownerName ?? UNASSIGNED_LABEL);
    row.hours = add(row.hours, {
      estimateHours: task.estimateHours,
      todoHours: task.todoHours,
      actualHours: task.actualHours,
    });
  }

  const teamRows: TeamCapacityTeamRow[] = [...teams.values()]
    .map((bucket) => {
      const members = [...bucket.members.values()].sort(sortMembers);
      // "Every Team total is the sum of its displayed member rows" — computed FROM the
      // rows, so the table can never fail to add up to its own header.
      const totals = members.reduce((acc, m) => add(acc, m.hours), { ...ZERO });
      return {
        id: bucket.id,
        name: bucket.name,
        totals: round(totals),
        members: members.map((m) => ({ ...m, hours: round(m.hours) })),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  // "All Teams totals are the sum of displayed Team rows" — same guarantee one level up.
  const totals = teamRows.reduce((acc, t) => add(acc, t.totals), { ...ZERO });

  return { totals: round(totals), teams: teamRows };
}

/** Unassigned sorts last; real members alphabetically. */
function sortMembers(a: TeamCapacityMemberRow, b: TeamCapacityMemberRow): number {
  if (a.id === null) return 1;
  if (b.id === null) return -1;
  return a.name.localeCompare(b.name);
}

/**
 * Is there anything at all to show?
 *
 * "Empty state explains whether there is no capacity and no scoped Task data for the
 * selected Iteration" — the two absences are different problems (nobody planned capacity
 * vs nobody has work), so they are reported separately rather than as one blank table.
 */
export function describeEmptiness(rollup: TeamCapacityRollup): {
  hasCapacity: boolean;
  hasTaskHours: boolean;
} {
  return {
    hasCapacity: rollup.totals.capacityHours > 0,
    hasTaskHours:
      rollup.totals.estimateHours > 0 ||
      rollup.totals.todoHours > 0 ||
      rollup.totals.actualHours > 0,
  };
}
