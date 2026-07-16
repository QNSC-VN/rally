import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { TeamStatusService } from './team-status.service';
import { PreconditionFailedException, ValidationException } from '@platform';
import { TEAM_STATUS_REPOSITORY } from '../domain/ports/team-status.repository';
import { IterationsService } from '@modules/iterations';
import { WorkItemsService } from '@modules/work-items';
import { AccessService } from '@modules/access';
import type { RawTeamStatusTaskRow } from '../domain/team-status.types';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const actor = {
  sub: 'user-1',
  workspaceId: 'ws-1',
  contextId: 'ws-1',
  sessionId: 's1',
  jti: 'j1',
  iat: 0,
  exp: 0,
  iss: 'rally',
  aud: 'rally-app',
  permissions: [] as string[],
  claims: { permissions: [] as string[] },
  authMethod: 'password' as const,
};

const mockIteration = {
  id: 'it-1',
  workspaceId: 'ws-1',
  projectId: 'proj-1',
  teamId: 'team-a',
  iterationKey: 'IT-1',
  name: 'Sprint 24.3',
  goal: null,
  theme: null,
  notes: null,
  state: 'committed' as const,
  plannedVelocity: 40,
  startDate: '2024-05-01',
  endDate: '2024-06-11',
  completedAt: null,
  createdAt: new Date('2024-06-01'),
  updatedAt: new Date('2024-06-01'),
};

const makeRawRow = (overrides: Partial<RawTeamStatusTaskRow> = {}): RawTeamStatusTaskRow => ({
  id: 'task-1',
  itemKey: 'PROJ-10',
  title: 'Implement login API',
  type: 'task',
  scheduleState: 'in_progress',
  parentId: 'story-1',
  parentKey: 'PROJ-5',
  parentType: 'story',
  parentTitle: 'User Authentication',
  parentScheduleState: 'in_progress',
  releaseId: 'rel-1',
  releaseName: 'v1.0',
  assigneeId: 'user-alice',
  assigneeDisplayName: 'Alice Smith',
  assigneeAvatarUrl: null,
  estimateHours: '8',
  todoHours: '3',
  actualHours: '5',
  rank: 'a1',
  ...overrides,
});

// ── Mock factories ────────────────────────────────────────────────────────────

const makeRepo = () => ({
  getTaskRows: vi.fn().mockResolvedValue([]),
  getRosterMembers: vi.fn().mockResolvedValue([]),
  getCapacities: vi.fn().mockResolvedValue(new Map()),
  upsertCapacity: vi.fn().mockResolvedValue({ userId: 'user-1', capacityHours: 40 }),
});

const makeIterationsService = () => ({
  getIteration: vi.fn().mockResolvedValue(mockIteration),
});

const makeWorkItemsService = () => ({
  getWorkItem: vi.fn(),
  updateWorkItem: vi.fn(),
  listTasks: vi.fn().mockResolvedValue([]),
});

const makeAccessService = () => ({
  assertProjectPermission: vi.fn().mockResolvedValue(undefined),
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('TeamStatusService', () => {
  let service: TeamStatusService;
  let repo: ReturnType<typeof makeRepo>;
  let iterations: ReturnType<typeof makeIterationsService>;
  let workItems: ReturnType<typeof makeWorkItemsService>;
  let access: ReturnType<typeof makeAccessService>;

  beforeEach(async () => {
    repo = makeRepo();
    iterations = makeIterationsService();
    workItems = makeWorkItemsService();
    access = makeAccessService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TeamStatusService,
        { provide: TEAM_STATUS_REPOSITORY, useValue: repo },
        { provide: IterationsService, useValue: iterations },
        { provide: WorkItemsService, useValue: workItems },
        { provide: AccessService, useValue: access },
      ],
    }).compile();

    service = module.get(TeamStatusService);
  });

  // ── getTeamStatus ─────────────────────────────────────────────────────────

  describe('getTeamStatus', () => {
    it('rejects when iteration belongs to a different project', async () => {
      iterations.getIteration.mockResolvedValue({
        ...mockIteration,
        projectId: 'other-proj',
      });

      await expect(service.getTeamStatus(actor, 'proj-1', 'team-a', 'it-1')).rejects.toThrow(
        PreconditionFailedException,
      );
    });

    it('groups tasks by assigneeId and computes per-member aggregates', async () => {
      repo.getTaskRows.mockResolvedValue([
        makeRawRow({
          id: 't1',
          assigneeId: 'alice',
          estimateHours: '4',
          todoHours: '2',
          actualHours: '2',
        }),
        makeRawRow({
          id: 't2',
          assigneeId: 'alice',
          estimateHours: '6',
          todoHours: '3',
          actualHours: '5',
        }),
        makeRawRow({
          id: 't3',
          assigneeId: 'bob',
          estimateHours: '3',
          todoHours: '3',
          actualHours: '0',
        }),
      ]);
      repo.getCapacities.mockResolvedValue(
        new Map([
          ['alice', 40],
          ['bob', 40],
        ]),
      );

      const result = await service.getTeamStatus(actor, 'proj-1', 'team-a', 'it-1');

      // Two groups: alice (2 tasks) and bob (1 task)
      expect(result.groups).toHaveLength(2);

      // Alice's group
      const alice = result.groups.find((g) => g.owner.id === 'alice')!;
      expect(alice.taskCount).toBe(2);
      expect(alice.estimateHours).toBe(10); // 4 + 6
      expect(alice.todoHours).toBe(5); // 2 + 3
      expect(alice.actualHours).toBe(7); // 2 + 5
      expect(alice.capacityHours).toBe(40);
      // progress = round(estimate/capacity * 100) = round(10/40 * 100) = 25
      expect(alice.progressPercent).toBe(25);

      // Bob's group
      const bob = result.groups.find((g) => g.owner.id === 'bob')!;
      expect(bob.taskCount).toBe(1);
      expect(bob.estimateHours).toBe(3);
      // progress = round(estimate/capacity * 100) = round(3/40 * 100) = 8
      expect(bob.progressPercent).toBe(8);

      // Totals
      expect(result.totals.estimateHours).toBe(13); // 10 + 3
      expect(result.totals.capacityHours).toBe(80); // 40 + 40
      expect(result.totals.actualHours).toBe(7);
    });

    it('keeps tasks with no assigneeId (unassigned rows are grouped)', async () => {
      repo.getTaskRows.mockResolvedValue([
        makeRawRow({ id: 't1', assigneeId: 'alice' }),
        makeRawRow({ id: 't2', assigneeId: null }),
        makeRawRow({ id: 't3', assigneeId: 'bob' }),
      ]);

      const result = await service.getTeamStatus(actor, 'proj-1', 'team-a', 'it-1');
      expect(result.groups).toHaveLength(3);
      expect(result.groups.some((g) => g.owner.id === 'alice')).toBe(true);
      expect(result.groups.some((g) => g.owner.id === 'bob')).toBe(true);
      expect(result.groups.some((g) => g.owner.id === 'unassigned')).toBe(true);
    });

    it('includes roster members with zero tasks (empty group, roster capacity, 0% load)', async () => {
      repo.getTaskRows.mockResolvedValue([
        makeRawRow({
          id: 't1',
          assigneeId: 'alice',
          assigneeDisplayName: 'Alice Smith',
          estimateHours: '4',
          todoHours: '2',
          actualHours: '1',
        }),
      ]);
      repo.getRosterMembers.mockResolvedValue([
        { id: 'alice', displayName: 'Alice Smith', avatarUrl: null },
        { id: 'bob', displayName: 'Bob Ray', avatarUrl: null },
      ]);
      repo.getCapacities.mockResolvedValue(
        new Map([
          ['alice', 40],
          ['bob', 20],
        ]),
      );

      const result = await service.getTeamStatus(actor, 'proj-1', 'team-a', 'it-1');

      // Both roster members present, even though bob has no tasks.
      expect(result.groups).toHaveLength(2);
      const bob = result.groups.find((g) => g.owner.id === 'bob')!;
      expect(bob.taskCount).toBe(0);
      expect(bob.tasks).toEqual([]);
      expect(bob.capacityHours).toBe(20);
      expect(bob.estimateHours).toBe(0);
      expect(bob.progressPercent).toBe(0);

      // Totals include the zero-task member's capacity (whole-roster sum).
      expect(result.totals.capacityHours).toBe(60);
      expect(result.totals.estimateHours).toBe(4);

      // Roster resolves from the iteration's team.
      expect(repo.getRosterMembers).toHaveBeenCalledWith({
        workspaceId: 'ws-1',
        projectId: 'proj-1',
        teamId: 'team-a',
      });
    });

    it('sorts groups alphabetically by owner displayName', async () => {
      repo.getTaskRows.mockResolvedValue([
        makeRawRow({ id: 't1', assigneeId: 'zara', assigneeDisplayName: 'Zara Jones' }),
        makeRawRow({ id: 't2', assigneeId: 'amy', assigneeDisplayName: 'Amy Lee' }),
      ]);
      repo.getCapacities.mockResolvedValue(
        new Map([
          ['zara', 40],
          ['amy', 40],
        ]),
      );

      const result = await service.getTeamStatus(actor, 'proj-1', 'team-a', 'it-1');
      expect(result.groups[0].owner.displayName).toBe('Amy Lee');
      expect(result.groups[1].owner.displayName).toBe('Zara Jones');
    });

    it('defaults capacity to 0 when repo returns no capacity for a user', async () => {
      repo.getTaskRows.mockResolvedValue([makeRawRow({ id: 't1', assigneeId: 'alice' })]);
      repo.getCapacities.mockResolvedValue(new Map()); // no capacity entry

      const result = await service.getTeamStatus(actor, 'proj-1', 'team-a', 'it-1');
      expect(result.groups[0].capacityHours).toBe(0);
    });

    it('returns empty groups and zero totals when no tasks exist', async () => {
      repo.getTaskRows.mockResolvedValue([]);

      const result = await service.getTeamStatus(actor, 'proj-1', 'team-a', 'it-1');
      expect(result.groups).toHaveLength(0);
      expect(result.totals.capacityHours).toBe(0);
      expect(result.totals.estimateHours).toBe(0);
    });

    it('includes iteration metadata in response', async () => {
      repo.getTaskRows.mockResolvedValue([]);

      const result = await service.getTeamStatus(actor, 'proj-1', 'team-a', 'it-1');
      expect(result.iteration.id).toBe('it-1');
      expect(result.iteration.name).toBe('Sprint 24.3');
      expect(result.iteration.startDate).toBe('2024-05-01');
      expect(result.iteration.endDate).toBe('2024-06-11');
    });

    it('allows progressPercent over 100 when estimate exceeds capacity', async () => {
      repo.getTaskRows.mockResolvedValue([
        makeRawRow({ id: 't1', assigneeId: 'alice', estimateHours: '50', actualHours: '5' }),
      ]);
      repo.getCapacities.mockResolvedValue(new Map([['alice', 40]]));

      const result = await service.getTeamStatus(actor, 'proj-1', 'team-a', 'it-1');
      // progress = round(50/40 * 100) = 125, no cap
      expect(result.groups[0].progressPercent).toBe(125);
    });

    it('returns 0% progress when capacity is 0', async () => {
      repo.getTaskRows.mockResolvedValue([
        makeRawRow({ id: 't1', assigneeId: 'alice', estimateHours: '5', actualHours: '3' }),
      ]);
      repo.getCapacities.mockResolvedValue(new Map()); // no capacity

      const result = await service.getTeamStatus(actor, 'proj-1', 'team-a', 'it-1');
      expect(result.groups[0].progressPercent).toBe(0);
    });

    it('normalizes schedule states per the mapping table', async () => {
      // Verify the toTaskRow normalizes: idea→Defined, in_progress→In-Progress, accepted→Completed
      repo.getTaskRows.mockResolvedValue([
        makeRawRow({ id: 't-idea', assigneeId: 'alice', scheduleState: 'idea' }),
        makeRawRow({ id: 't-ip', assigneeId: 'bob', scheduleState: 'in_progress' }),
        makeRawRow({ id: 't-done', assigneeId: 'carol', scheduleState: 'accepted' }),
      ]);
      repo.getCapacities.mockResolvedValue(
        new Map([
          ['alice', 40],
          ['bob', 40],
          ['carol', 40],
        ]),
      );

      const result = await service.getTeamStatus(actor, 'proj-1', 'team-a', 'it-1');
      expect(result.groups.find((g) => g.owner.id === 'alice')!.tasks[0].state).toBe('Defined');
      expect(result.groups.find((g) => g.owner.id === 'bob')!.tasks[0].state).toBe('In-Progress');
      expect(result.groups.find((g) => g.owner.id === 'carol')!.tasks[0].state).toBe('Completed');
    });

    it('defaults unknown schedule states to Defined', async () => {
      repo.getTaskRows.mockResolvedValue([
        makeRawRow({ id: 't1', assigneeId: 'alice', scheduleState: 'some_unknown_state' }),
      ]);
      repo.getCapacities.mockResolvedValue(new Map([['alice', 40]]));

      const result = await service.getTeamStatus(actor, 'proj-1', 'team-a', 'it-1');
      expect(result.groups[0].tasks[0].state).toBe('Defined');
    });
  });

  // ── updateCapacity ───────────────────────────────────────────────────────

  describe('updateCapacity', () => {
    it('delegates to repo after asserting edit permission', async () => {
      await service.updateCapacity(actor, {
        projectId: 'proj-1',
        teamId: 'team-a',
        iterationId: 'it-1',
        userId: 'alice',
        capacityHours: 40,
      });

      expect(access.assertProjectPermission).toHaveBeenCalledWith(
        actor,
        'proj-1',
        expect.any(String),
      );
      expect(repo.upsertCapacity).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'alice', capacityHours: 40 }),
      );
    });

    it('rejects negative capacity', async () => {
      await expect(
        service.updateCapacity(actor, {
          projectId: 'proj-1',
          teamId: 'team-a',
          iterationId: 'it-1',
          userId: 'alice',
          capacityHours: -5,
        }),
      ).rejects.toThrow(ValidationException);
      expect(repo.upsertCapacity).not.toHaveBeenCalled();
    });

    it('allows zero capacity', async () => {
      await service.updateCapacity(actor, {
        projectId: 'proj-1',
        teamId: 'team-a',
        iterationId: 'it-1',
        userId: 'alice',
        capacityHours: 0,
      });
      expect(repo.upsertCapacity).toHaveBeenCalled();
    });
  });

  // ── updateTask ───────────────────────────────────────────────────────────

  describe('updateTask', () => {
    it('rejects empty title after trimming', async () => {
      workItems.getWorkItem.mockResolvedValue({
        id: 'task-1',
        projectId: 'proj-1',
        workspaceId: 'ws-1',
      });

      await expect(service.updateTask(actor, 'task-1', { title: '   ' })).rejects.toThrow(
        ValidationException,
      );
    });

    it('maps Completed state to completed scheduleState', async () => {
      workItems.getWorkItem.mockResolvedValue({
        id: 'task-1',
        projectId: 'proj-1',
        workspaceId: 'ws-1',
      });
      workItems.updateWorkItem.mockResolvedValue({
        id: 'task-1',
        itemKey: 'PROJ-10',
        title: 'Updated Task',
        scheduleState: 'completed',
        parentId: null,
      });

      const result = await service.updateTask(actor, 'task-1', { state: 'Completed' });
      expect(workItems.updateWorkItem).toHaveBeenCalledWith(actor, 'task-1', {
        scheduleState: 'completed',
      });
      expect(result.state).toBe('Completed');
    });

    it('never force-completes the parent — reports the parent status decided by the gated roll-up', async () => {
      workItems.getWorkItem
        .mockResolvedValueOnce({ id: 'task-1', projectId: 'proj-1', workspaceId: 'ws-1' })
        .mockResolvedValueOnce({ id: 'story-1', itemKey: 'PROJ-5', scheduleState: 'in_progress' });
      workItems.updateWorkItem.mockResolvedValue({
        id: 'task-1',
        itemKey: 'PROJ-10',
        title: 'Task',
        scheduleState: 'completed',
        parentId: 'story-1',
      });

      const result = await service.updateTask(actor, 'task-1', { state: 'Completed' });

      // Only the task is updated; the parent is NEVER updated from here.
      expect(workItems.updateWorkItem).toHaveBeenCalledTimes(1);
      expect(workItems.updateWorkItem).toHaveBeenCalledWith(actor, 'task-1', {
        scheduleState: 'completed',
      });
      // workProduct reflects the parent's ACTUAL status (still in_progress).
      expect(result.workProduct).toEqual({
        id: 'story-1',
        key: 'PROJ-5',
        status: 'in_progress',
      });
    });

    it('reports parent as completed when the gated roll-up completed it', async () => {
      workItems.getWorkItem
        .mockResolvedValueOnce({ id: 'task-1', projectId: 'proj-1', workspaceId: 'ws-1' })
        .mockResolvedValueOnce({ id: 'story-1', itemKey: 'PROJ-5', scheduleState: 'completed' });
      workItems.updateWorkItem.mockResolvedValue({
        id: 'task-1',
        itemKey: 'PROJ-10',
        title: 'Task',
        scheduleState: 'completed',
        parentId: 'story-1',
      });

      const result = await service.updateTask(actor, 'task-1', { state: 'Completed' });

      expect(workItems.updateWorkItem).toHaveBeenCalledTimes(1);
      expect(result.workProduct).toEqual({
        id: 'story-1',
        key: 'PROJ-5',
        status: 'completed',
      });
    });

    it('re-reads parent on non-Completed edits too, without updating it', async () => {
      workItems.getWorkItem
        .mockResolvedValueOnce({ id: 'task-1', projectId: 'proj-1', workspaceId: 'ws-1' })
        .mockResolvedValueOnce({ id: 'story-1', itemKey: 'PROJ-5', scheduleState: 'in_progress' });
      workItems.updateWorkItem.mockResolvedValue({
        id: 'task-1',
        itemKey: 'PROJ-10',
        title: 'Task',
        scheduleState: 'in_progress',
        parentId: 'story-1',
      });

      await service.updateTask(actor, 'task-1', { state: 'In-Progress' });
      expect(workItems.updateWorkItem).toHaveBeenCalledTimes(1);
    });

    it('gracefully handles a parent re-read failure (logs warning, non-fatal)', async () => {
      // Task load succeeds; parent re-read throws.
      workItems.getWorkItem
        .mockResolvedValueOnce({ id: 'task-1', projectId: 'proj-1', workspaceId: 'ws-1' })
        .mockRejectedValueOnce(new Error('Parent read failed'));
      workItems.updateWorkItem.mockResolvedValue({
        id: 'task-1',
        itemKey: 'PROJ-10',
        title: 'Task',
        scheduleState: 'completed',
        parentId: 'story-1',
      });

      const result = await service.updateTask(actor, 'task-1', { state: 'Completed' });
      // Should NOT throw — the re-read is best-effort.
      expect(result.workProduct).toBeUndefined();
    });
  });
});
