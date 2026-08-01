import { describe, expect, it } from 'vitest';
import {
  UNASSIGNED_LABEL,
  describeEmptiness,
  rollUpTeamCapacity,
  type CapacityRecord,
  type ScopedTaskHours,
} from './team-capacity';

const capacity = (over: Partial<CapacityRecord> = {}): CapacityRecord => ({
  teamId: 'core',
  teamName: 'Core Platform',
  memberId: 'u1',
  memberName: 'Marcus Webb',
  capacityHours: 96,
  ...over,
});

const task = (over: Partial<ScopedTaskHours> = {}): ScopedTaskHours => ({
  taskId: 't1',
  teamId: 'core',
  teamName: 'Core Platform',
  ownerId: 'u1',
  ownerName: 'Marcus Webb',
  estimateHours: 6,
  todoHours: 0,
  actualHours: 6,
  ...over,
});

describe('rollUpTeamCapacity (Team Capacity §3, §4)', () => {
  it('keeps a member with capacity and no tasks visible (example 4)', () => {
    const r = rollUpTeamCapacity({
      capacities: [capacity({ memberId: 'u9', memberName: 'Priya Nair', capacityHours: 60 })],
      tasks: [],
    });
    expect(r.teams[0].members).toEqual([
      {
        id: 'u9',
        name: 'Priya Nair',
        hours: { capacityHours: 60, estimateHours: 0, todoHours: 0, actualHours: 0 },
      },
    ]);
  });

  it('keeps a task owner with no capacity record visible at 0h capacity (example 5)', () => {
    // A missing capacity record is a planning gap, never inferred from task hours.
    const r = rollUpTeamCapacity({
      capacities: [],
      tasks: [
        task({
          ownerId: 'u7',
          ownerName: 'Sarah Chen',
          estimateHours: 18,
          todoHours: 10,
          actualHours: 8,
        }),
      ],
    });
    expect(r.teams[0].members[0].hours).toEqual({
      capacityHours: 0,
      estimateHours: 18,
      todoHours: 10,
      actualHours: 8,
    });
  });

  it('shows a multi-Team person once inside each Team, never merged (§2)', () => {
    const r = rollUpTeamCapacity({
      capacities: [
        capacity({ capacityHours: 96 }),
        capacity({ teamId: 'iam', teamName: 'Identity & Access', capacityHours: 60 }),
      ],
      tasks: [],
    });
    expect(r.teams.map((t) => [t.name, t.totals.capacityHours])).toEqual([
      ['Core Platform', 96],
      ['Identity & Access', 60],
    ]);
    expect(r.totals.capacityHours).toBe(156);
  });

  it('makes every Team total the sum of its displayed member rows, and the grand total the sum of Teams', () => {
    const r = rollUpTeamCapacity({
      capacities: [
        capacity({ memberId: 'u1', capacityHours: 96 }),
        capacity({ memberId: 'u2', memberName: 'Sarah Chen', capacityHours: 82 }),
      ],
      tasks: [
        task({ taskId: 't1', ownerId: 'u1', estimateHours: 6, todoHours: 0, actualHours: 6 }),
        task({
          taskId: 't2',
          ownerId: 'u2',
          ownerName: 'Sarah Chen',
          estimateHours: 18,
          todoHours: 10,
          actualHours: 8,
        }),
      ],
    });
    // The mockup's Core Platform row: 178h / 24h / 10h / 14h.
    expect(r.teams[0].totals).toEqual({
      capacityHours: 178,
      estimateHours: 24,
      todoHours: 10,
      actualHours: 14,
    });
    expect(r.totals).toEqual(r.teams[0].totals);
  });

  it('de-duplicates tasks by task id before aggregating (§8)', () => {
    const r = rollUpTeamCapacity({
      capacities: [],
      tasks: [task({ taskId: 't1' }), task({ taskId: 't1' })],
    });
    expect(r.totals.estimateHours).toBe(6);
  });

  it('groups an unowned task under Unassigned with 0h capacity (§4)', () => {
    const r = rollUpTeamCapacity({
      capacities: [capacity()],
      tasks: [task({ taskId: 't2', ownerId: null, ownerName: null, estimateHours: 4 })],
    });
    const unassigned = r.teams[0].members.find((m) => m.id === null);
    expect(unassigned?.name).toBe(UNASSIGNED_LABEL);
    expect(unassigned?.hours.capacityHours).toBe(0);
    expect(unassigned?.hours.estimateHours).toBe(4);
    // Unassigned sorts last so it cannot be mistaken for a person.
    expect(r.teams[0].members.at(-1)?.id).toBeNull();
  });

  it('reports the values as-is: Actual is not capped and ToDo is not derived (example 6)', () => {
    const r = rollUpTeamCapacity({
      capacities: [],
      tasks: [task({ estimateHours: 6, todoHours: 2, actualHours: 8 })],
    });
    expect(r.totals.estimateHours).toBe(6);
    expect(r.totals.todoHours).toBe(2); // NOT estimate - actual
    expect(r.totals.actualHours).toBe(8); // NOT capped at estimate
  });

  it('rounds only the displayed values, after aggregating at full precision', () => {
    const r = rollUpTeamCapacity({
      capacities: [],
      tasks: [
        task({ taskId: 't1', estimateHours: 0.1, todoHours: 0, actualHours: 0 }),
        task({ taskId: 't2', estimateHours: 0.2, todoHours: 0, actualHours: 0 }),
      ],
    });
    expect(r.totals.estimateHours).toBe(0.3);
  });
});

describe('describeEmptiness', () => {
  it('separates "nobody planned capacity" from "nobody has scoped work"', () => {
    const capacityOnly = rollUpTeamCapacity({ capacities: [capacity()], tasks: [] });
    expect(describeEmptiness(capacityOnly)).toEqual({ hasCapacity: true, hasTaskHours: false });

    const tasksOnly = rollUpTeamCapacity({ capacities: [], tasks: [task()] });
    expect(describeEmptiness(tasksOnly)).toEqual({ hasCapacity: false, hasTaskHours: true });

    const nothing = rollUpTeamCapacity({ capacities: [], tasks: [] });
    expect(describeEmptiness(nothing)).toEqual({ hasCapacity: false, hasTaskHours: false });
    expect(nothing.teams).toEqual([]);
  });
});
