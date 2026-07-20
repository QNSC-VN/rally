import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { WorkItemsService } from './work-items.service';
import { WORK_ITEM_REPOSITORY } from '../domain/ports/work-item.repository';
import { ACTIVITY_LOG_REPOSITORY } from '../domain/ports/activity-log.repository';
import { TIME_LOG_REPOSITORY } from '../domain/ports/time-log.repository';
import { WATCHER_REPOSITORY } from '../domain/ports/watcher.repository';
import { ATTACHMENT_REPOSITORY } from '../domain/ports/attachment.repository';
import { WORK_ITEM_RELATION_REPOSITORY } from '../domain/ports/work-item-relation.repository';
import { NotificationSchedulerService } from '@platform/notifications/notification-scheduler.service';
import { StorageService } from '@platform';
import type { WorkItem } from '../domain/work-item.types';
import { NotFoundException, PreconditionFailedException, UnitOfWork } from '@platform';
import { ProjectsService } from '@modules/projects';
import { AccessService } from '@modules/access';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const now = new Date('2024-06-01');

const mockWorkItem = (o: Partial<WorkItem> = {}): WorkItem => ({
  id: 'wi-1',
  workspaceId: 'ws-1',
  projectId: 'proj-1',
  itemKey: 'PROJ-1',
  type: 'story',
  title: 'Test story',
  description: null,
  statusId: 'status-todo',
  scheduleState: 'defined',
  flowState: 'defined',
  priority: 'none',
  assigneeId: null,
  reporterId: null,
  parentId: null,
  teamId: null,
  iterationId: null,
  releaseId: null,
  storyPoints: null,
  estimateHours: null,
  todoHours: null,
  actualHours: null,
  acceptanceCriteria: null,
  notes: null,
  releaseNotes: null,
  isBlocked: false,
  blockedReason: null,
  rank: 'a1',
  customFields: {},
  createdBy: 'user-1',
  updatedBy: null,
  createdAt: now,
  updatedAt: now,
  deletedAt: null,
  // P3.4 — Defect-specific fields
  severity: null,
  foundInEnvironment: null,
  foundInReleaseId: null,
  rootCause: null,
  resolution: null,
  devOwnerId: null,
  defectState: null,
  fixedInBuild: null,
  ...o,
});

const mockActor = {
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

const mockStatus = (id: string, isDefault = false) => ({
  id,
  workspaceId: 'ws-1',
  projectId: 'proj-1',
  name: id,
  category: 'todo' as const,
  isDefault,
  position: 1,
  color: '#000',
  createdAt: now,
  updatedAt: now,
});

// ── Mock factories ────────────────────────────────────────────────────────────

const makeWorkItemRepo = () => ({
  findById: vi.fn(),
  findByIds: vi.fn().mockResolvedValue([]),
  findIterationScope: vi.fn().mockResolvedValue(null),
  findReleaseProject: vi.fn().mockResolvedValue(null),
  assignIteration: vi.fn().mockResolvedValue(undefined),
  assignRelease: vi.fn().mockResolvedValue(undefined),
  listByProject: vi.fn(),
  listBacklog: vi.fn(),
  listTasksByParent: vi.fn(),
  findMaxRank: vi.fn().mockResolvedValue(null),
  getTaskTotals: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  softDelete: vi.fn().mockResolvedValue(undefined),
  reorderItems: vi.fn().mockResolvedValue(undefined),
  addLabel: vi.fn().mockResolvedValue(undefined),
  removeLabel: vi.fn().mockResolvedValue(undefined),
  listLabels: vi.fn(),
  listMilestones: vi.fn().mockResolvedValue([]),
  setMilestones: vi.fn().mockResolvedValue(undefined),
  countMilestonesInProject: vi.fn().mockResolvedValue(0),
  areAllTasksComplete: vi.fn().mockResolvedValue(false),
  autoAcceptIterationIfComplete: vi.fn().mockResolvedValue(false),
});

const makeRelationRepo = () => ({
  listForItem: vi.fn().mockResolvedValue([]),
  exists: vi.fn().mockResolvedValue(false),
  create: vi.fn().mockResolvedValue({ id: 'rel-1' }),
  findById: vi.fn(),
  delete: vi.fn().mockResolvedValue(undefined),
  wouldCreateCycle: vi.fn().mockResolvedValue(false),
});

const makeActivityRepo = () => ({
  append: vi.fn().mockResolvedValue(undefined),
  appendMany: vi.fn().mockResolvedValue(undefined),
  listByWorkItem: vi.fn(),
});

const makeUnitOfWork = () => ({
  run: vi.fn(async (cb: (tx: unknown) => unknown) => cb({})),
});

const makeProjectsService = () => {
  const listProjectTeams = vi.fn().mockResolvedValue([]);
  return {
    getProject: vi.fn().mockResolvedValue({ id: 'proj-1', workspaceId: 'ws-1' }),
    listStatuses: vi
      .fn()
      .mockResolvedValue([mockStatus('status-todo', true), mockStatus('status-done')]),
    assertTransitionAllowed: vi.fn().mockResolvedValue(undefined),
    generateItemKey: vi.fn().mockResolvedValue('PROJ-42'),
    listProjectTeams,
    // Mirrors the real ProjectsService.assertTeamLinkedToProject so tests keep
    // driving the outcome via the listProjectTeams mock.
    assertTeamLinkedToProject: vi.fn(async (ws: string, projectId: string, teamId: string) => {
      const links = (await listProjectTeams(ws, projectId)) as Array<{
        teamId: string;
        status: string;
      }>;
      if (!links.some((l) => l.teamId === teamId && l.status === 'active')) {
        throw new PreconditionFailedException(
          'PROJECT_TEAM_LINK_NOT_FOUND',
          'Team is not linked to this project',
        );
      }
    }),
    // P1-15: scope validation helpers
    assertWorkspaceMember: vi.fn().mockResolvedValue(undefined),
    assertLabelBelongsToProject: vi.fn().mockResolvedValue(undefined),
  };
};

// Grants everything by default; individual tests override to assert denial.
const makeAccessService = () => ({
  assertProjectPermission: vi.fn().mockResolvedValue(undefined),
  getProjectPermissions: vi.fn().mockResolvedValue(['work_item:*']),
});

const makeTimeLogRepo = () => ({
  findById: vi.fn(),
  listByWorkItem: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  softDelete: vi.fn().mockResolvedValue(undefined),
});

const makeWatcherRepo = () => ({
  listByWorkItem: vi.fn(),
  isWatching: vi.fn(),
  watch: vi.fn().mockResolvedValue(undefined),
  unwatch: vi.fn().mockResolvedValue(undefined),
  watchMany: vi.fn().mockResolvedValue(undefined),
  listUserIds: vi.fn(),
});

const makeAttachmentRepo = () => ({
  findById: vi.fn(),
  listByWorkItem: vi.fn(),
  countByWorkItem: vi.fn().mockResolvedValue(0),
  create: vi.fn(),
  confirm: vi.fn(),
  softDelete: vi.fn().mockResolvedValue(undefined),
});

const makeStorageService = () => ({
  presignPut: vi.fn().mockResolvedValue({ uploadUrl: 'https://s3.example.com/upload' }),
  presignGet: vi.fn().mockResolvedValue('https://s3.example.com/download'),
  headObject: vi.fn().mockResolvedValue({ contentLength: 1024 }),
  deleteObject: vi.fn().mockResolvedValue(undefined),
  cdnUrl: vi.fn().mockReturnValue(null),
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('WorkItemsService', () => {
  let service: WorkItemsService;
  let workItemRepo: ReturnType<typeof makeWorkItemRepo>;
  let activityRepo: ReturnType<typeof makeActivityRepo>;
  let projectsService: ReturnType<typeof makeProjectsService>;
  let accessService: ReturnType<typeof makeAccessService>;
  let uow: ReturnType<typeof makeUnitOfWork>;
  let timeLogRepo: ReturnType<typeof makeTimeLogRepo>;
  let watcherRepo: ReturnType<typeof makeWatcherRepo>;
  let attachmentRepo: ReturnType<typeof makeAttachmentRepo>;
  let storageService: ReturnType<typeof makeStorageService>;
  let relationRepo: ReturnType<typeof makeRelationRepo>;

  beforeEach(async () => {
    workItemRepo = makeWorkItemRepo();
    activityRepo = makeActivityRepo();
    projectsService = makeProjectsService();
    accessService = makeAccessService();
    uow = makeUnitOfWork();
    timeLogRepo = makeTimeLogRepo();
    watcherRepo = makeWatcherRepo();
    attachmentRepo = makeAttachmentRepo();
    storageService = makeStorageService();
    relationRepo = makeRelationRepo();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkItemsService,
        { provide: WORK_ITEM_REPOSITORY, useValue: workItemRepo },
        { provide: ACTIVITY_LOG_REPOSITORY, useValue: activityRepo },
        { provide: TIME_LOG_REPOSITORY, useValue: timeLogRepo },
        { provide: WATCHER_REPOSITORY, useValue: watcherRepo },
        { provide: ATTACHMENT_REPOSITORY, useValue: attachmentRepo },
        { provide: WORK_ITEM_RELATION_REPOSITORY, useValue: relationRepo },
        {
          provide: NotificationSchedulerService,
          useValue: { schedule: vi.fn().mockResolvedValue(undefined) },
        },
        { provide: StorageService, useValue: storageService },
        { provide: ProjectsService, useValue: projectsService },
        { provide: AccessService, useValue: accessService },
        { provide: UnitOfWork, useValue: uow },
      ],
    }).compile();

    service = module.get(WorkItemsService);
  });

  // ── listWorkItems ──────────────────────────────────────────────────────────

  describe('listWorkItems', () => {
    it('validates project access and returns items', async () => {
      workItemRepo.listByProject.mockResolvedValue({
        data: [mockWorkItem()],
        pageInfo: { nextCursor: null, hasNextPage: false, limit: 20 },
      });

      const result = await service.listWorkItems(
        mockActor,
        'proj-1',
        {},
        { limit: 20, cursor: null },
      );

      expect(projectsService.getProject).toHaveBeenCalledWith('ws-1', 'proj-1');
      expect(result.data).toHaveLength(1);
    });
  });

  // ── createWorkItem ─────────────────────────────────────────────────────────

  describe('createWorkItem', () => {
    it('creates work item using default status when none provided', async () => {
      workItemRepo.create.mockResolvedValue(
        mockWorkItem({ statusId: 'status-todo', itemKey: 'PROJ-42' }),
      );

      const result = await service.createWorkItem(mockActor, 'proj-1', 'story', 'My story');

      expect(result.statusId).toBe('status-todo');
      expect(result.itemKey).toBe('PROJ-42');
      expect(workItemRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ statusId: 'status-todo', workspaceId: 'ws-1' }),
        expect.anything(),
      );
    });

    it('uses provided valid statusId', async () => {
      workItemRepo.create.mockResolvedValue(mockWorkItem({ statusId: 'status-done' }));

      await service.createWorkItem(mockActor, 'proj-1', 'story', 'Story', {
        statusId: 'status-done',
      });

      expect(workItemRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ statusId: 'status-done' }),
        expect.anything(),
      );
    });

    it('throws NotFoundException for unknown statusId', async () => {
      await expect(
        service.createWorkItem(mockActor, 'proj-1', 'story', 'Story', {
          statusId: 'status-nonexistent',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws PreconditionFailedException when no statuses configured', async () => {
      projectsService.listStatuses.mockResolvedValue([]);

      await expect(service.createWorkItem(mockActor, 'proj-1', 'story', 'Story')).rejects.toThrow(
        PreconditionFailedException,
      );
    });

    it('defaults priority to none', async () => {
      workItemRepo.create.mockResolvedValue(mockWorkItem({ priority: 'none' }));
      await service.createWorkItem(mockActor, 'proj-1', 'story', 'Story');

      expect(workItemRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ priority: 'none' }),
        expect.anything(),
      );
    });

    it('rejects an iteration that belongs to a different project', async () => {
      workItemRepo.findIterationScope.mockResolvedValue({ projectId: 'other-proj', teamId: null });
      await expect(
        service.createWorkItem(mockActor, 'proj-1', 'story', 'Story', { iterationId: 'iter-x' }),
      ).rejects.toThrow(PreconditionFailedException);
      expect(workItemRepo.create).not.toHaveBeenCalled();
    });

    it('rejects a release that belongs to a different project', async () => {
      workItemRepo.findReleaseProject.mockResolvedValue('other-proj');
      await expect(
        service.createWorkItem(mockActor, 'proj-1', 'story', 'Story', { releaseId: 'rel-x' }),
      ).rejects.toThrow(PreconditionFailedException);
      expect(workItemRepo.create).not.toHaveBeenCalled();
    });

    it('rejects a defect foundInReleaseId from a different project', async () => {
      workItemRepo.findReleaseProject.mockResolvedValue('other-proj');
      await expect(
        service.createWorkItem(mockActor, 'proj-1', 'defect', 'Bug', {
          foundInReleaseId: 'rel-x',
        }),
      ).rejects.toThrow(PreconditionFailedException);
      expect(workItemRepo.create).not.toHaveBeenCalled();
    });

    it('rejects a reporterId who is not a workspace member', async () => {
      projectsService.assertWorkspaceMember.mockRejectedValueOnce(new Error('NOT_MEMBER'));
      await expect(
        service.createWorkItem(mockActor, 'proj-1', 'story', 'Story', {
          reporterId: 'foreign-user',
        }),
      ).rejects.toThrow('NOT_MEMBER');
      expect(workItemRepo.create).not.toHaveBeenCalled();
    });

    it('rejects a devOwnerId who is not a workspace member', async () => {
      projectsService.assertWorkspaceMember.mockRejectedValueOnce(new Error('NOT_MEMBER'));
      await expect(
        service.createWorkItem(mockActor, 'proj-1', 'defect', 'Bug', {
          devOwnerId: 'foreign-user',
        }),
      ).rejects.toThrow('NOT_MEMBER');
      expect(workItemRepo.create).not.toHaveBeenCalled();
    });
  });

  // ── createTask ─────────────────────────────────────────────────────────────

  describe('createTask', () => {
    it('inherits the team from the parent when none is provided', async () => {
      workItemRepo.findById.mockResolvedValue(
        mockWorkItem({ id: 'parent-1', projectId: 'proj-1', teamId: 'team-p' }),
      );
      projectsService.listProjectTeams.mockResolvedValue([{ teamId: 'team-p', status: 'active' }]);
      workItemRepo.create.mockResolvedValue(mockWorkItem({ type: 'task', teamId: 'team-p' }));

      await service.createTask(mockActor, 'parent-1', 'My task');

      expect(workItemRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ teamId: 'team-p' }),
        expect.anything(),
      );
    });

    it('uses the explicitly provided team over the parent team', async () => {
      workItemRepo.findById.mockResolvedValue(
        mockWorkItem({ id: 'parent-1', projectId: 'proj-1', teamId: 'team-p' }),
      );
      projectsService.listProjectTeams.mockResolvedValue([{ teamId: 'team-x', status: 'active' }]);
      workItemRepo.create.mockResolvedValue(mockWorkItem({ type: 'task', teamId: 'team-x' }));

      await service.createTask(mockActor, 'parent-1', 'My task', { teamId: 'team-x' });

      expect(workItemRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ teamId: 'team-x' }),
        expect.anything(),
      );
    });

    // ── DEV-013: Task Estimate is read-only derived (Estimate = To Do + Actuals) ──
    it('derives Estimate from To Do + Actual and ignores any client-supplied estimate', async () => {
      workItemRepo.findById.mockResolvedValue(
        mockWorkItem({ id: 'parent-1', projectId: 'proj-1', teamId: 'team-p' }),
      );
      projectsService.listProjectTeams.mockResolvedValue([{ teamId: 'team-p', status: 'active' }]);
      workItemRepo.create.mockResolvedValue(mockWorkItem({ type: 'task' }));

      await service.createTask(mockActor, 'parent-1', 'My task', {
        todoHours: '3',
        actualHours: '2',
        estimateHours: '99', // must be ignored — Estimate is derived
      });

      expect(workItemRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ estimateHours: '5.00', todoHours: '3', actualHours: '2' }),
        expect.anything(),
      );
    });
  });

  // ── getWorkItem ────────────────────────────────────────────────────────────

  describe('getWorkItem', () => {
    it('returns work item when found and belongs to workspace', async () => {
      workItemRepo.findById.mockResolvedValue(mockWorkItem());
      const result = await service.getWorkItem('ws-1', 'wi-1');
      expect(result.title).toBe('Test story');
    });

    it('throws NotFoundException when not found', async () => {
      workItemRepo.findById.mockResolvedValue(null);
      await expect(service.getWorkItem('ws-1', 'missing')).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when workspace mismatch', async () => {
      workItemRepo.findById.mockResolvedValue(mockWorkItem({ workspaceId: 'other-ws' }));
      await expect(service.getWorkItem('ws-1', 'wi-1')).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException for soft-deleted item', async () => {
      workItemRepo.findById.mockResolvedValue(mockWorkItem({ deletedAt: now }));
      await expect(service.getWorkItem('ws-1', 'wi-1')).rejects.toThrow(NotFoundException);
    });
  });

  // ── updateWorkItem ─────────────────────────────────────────────────────────

  describe('updateWorkItem', () => {
    it('updates work item', async () => {
      workItemRepo.findById.mockResolvedValue(mockWorkItem());
      workItemRepo.update.mockResolvedValue(mockWorkItem({ title: 'Updated' }));

      const result = await service.updateWorkItem(mockActor, 'wi-1', { title: 'Updated' });
      expect(result.title).toBe('Updated');
    });

    it('validates transition when statusId changes', async () => {
      workItemRepo.findById.mockResolvedValue(mockWorkItem({ statusId: 'status-todo' }));
      workItemRepo.update.mockResolvedValue(mockWorkItem({ statusId: 'status-done' }));

      await service.updateWorkItem(mockActor, 'wi-1', { statusId: 'status-done' });

      expect(projectsService.assertTransitionAllowed).toHaveBeenCalledWith(
        'proj-1',
        'status-todo',
        'status-done',
      );
    });

    it('skips transition check when statusId unchanged', async () => {
      workItemRepo.findById.mockResolvedValue(mockWorkItem({ statusId: 'status-todo' }));
      workItemRepo.update.mockResolvedValue(mockWorkItem());

      await service.updateWorkItem(mockActor, 'wi-1', { statusId: 'status-todo' });

      expect(projectsService.assertTransitionAllowed).not.toHaveBeenCalled();
    });

    // ── BR-WI-01: Schedule State <-> Flow State mirror ──
    it('mirrors a Schedule State change onto Flow State', async () => {
      workItemRepo.findById.mockResolvedValue(mockWorkItem({ scheduleState: 'defined' }));
      workItemRepo.update.mockResolvedValue(mockWorkItem({ scheduleState: 'in_progress' }));

      await service.updateWorkItem(mockActor, 'wi-1', { scheduleState: 'in_progress' });

      expect(workItemRepo.update).toHaveBeenCalledWith(
        'wi-1',
        expect.objectContaining({ scheduleState: 'in_progress', flowState: 'in_progress' }),
        'ws-1',
        expect.anything(),
      );
    });

    it('mirrors a Flow State change onto Schedule State', async () => {
      workItemRepo.findById.mockResolvedValue(mockWorkItem({ scheduleState: 'defined' }));
      workItemRepo.update.mockResolvedValue(mockWorkItem({ scheduleState: 'in_progress' }));

      await service.updateWorkItem(mockActor, 'wi-1', { flowState: 'in_progress' });

      expect(workItemRepo.update).toHaveBeenCalledWith(
        'wi-1',
        expect.objectContaining({ scheduleState: 'in_progress', flowState: 'in_progress' }),
        'ws-1',
        expect.anything(),
      );
    });

    it('rejects a request that sets Schedule and Flow to conflicting values', async () => {
      workItemRepo.findById.mockResolvedValue(mockWorkItem());

      await expect(
        service.updateWorkItem(mockActor, 'wi-1', {
          scheduleState: 'in_progress',
          flowState: 'completed',
        }),
      ).rejects.toThrow(PreconditionFailedException);
      expect(workItemRepo.update).not.toHaveBeenCalled();
    });

    // ── BR-TASK-02 / DEV-018: reverse roll-up ──
    it('reopens a completed parent when a child task leaves Completed', async () => {
      const task = mockWorkItem({
        id: 'task-1',
        type: 'task',
        scheduleState: 'completed',
        parentId: 'parent-1',
      });
      const parent = mockWorkItem({ id: 'parent-1', scheduleState: 'completed' });
      workItemRepo.findById.mockImplementation((id: string) =>
        Promise.resolve(id === 'parent-1' ? parent : task),
      );
      workItemRepo.update.mockResolvedValue(mockWorkItem({ id: 'task-1', type: 'task' }));

      await service.updateWorkItem(mockActor, 'task-1', { scheduleState: 'in_progress' });

      expect(workItemRepo.update).toHaveBeenCalledWith(
        'parent-1',
        expect.objectContaining({ scheduleState: 'in_progress' }),
        'ws-1',
        expect.anything(),
      );
    });

    it('never reverts a parent already Accepted when a child task reopens', async () => {
      const task = mockWorkItem({
        id: 'task-1',
        type: 'task',
        scheduleState: 'completed',
        parentId: 'parent-1',
      });
      const parent = mockWorkItem({ id: 'parent-1', scheduleState: 'accepted' });
      workItemRepo.findById.mockImplementation((id: string) =>
        Promise.resolve(id === 'parent-1' ? parent : task),
      );
      workItemRepo.update.mockResolvedValue(mockWorkItem({ id: 'task-1', type: 'task' }));

      await service.updateWorkItem(mockActor, 'task-1', { scheduleState: 'in_progress' });

      expect(workItemRepo.update).not.toHaveBeenCalledWith(
        'parent-1',
        expect.anything(),
        'ws-1',
        expect.anything(),
      );
    });

    // ── DEV-013/015: Task Estimate = To Do + Actuals (read-only derived) ──
    it('recomputes a task Estimate from To Do + Actual on update', async () => {
      const task = mockWorkItem({ id: 'task-1', type: 'task', todoHours: '1', actualHours: '1' });
      workItemRepo.findById.mockResolvedValue(task);
      workItemRepo.update.mockResolvedValue(mockWorkItem({ id: 'task-1', type: 'task' }));

      await service.updateWorkItem(mockActor, 'task-1', { todoHours: '4' });

      // 4 (new To Do) + 1 (existing Actual) = 5.00
      expect(workItemRepo.update).toHaveBeenCalledWith(
        'task-1',
        expect.objectContaining({ estimateHours: '5.00' }),
        'ws-1',
        expect.anything(),
      );
    });

    it('does NOT auto-zero To Do when a task is completed (DEV-015)', async () => {
      const task = mockWorkItem({
        id: 'task-1',
        type: 'task',
        scheduleState: 'in_progress',
        todoHours: '3',
        actualHours: '2',
        parentId: null,
      });
      workItemRepo.findById.mockResolvedValue(task);
      workItemRepo.update.mockResolvedValue(mockWorkItem({ id: 'task-1', type: 'task' }));

      await service.updateWorkItem(mockActor, 'task-1', { scheduleState: 'completed' });

      const call = workItemRepo.update.mock.calls.find((c) => c[0] === 'task-1');
      // To Do must be preserved (not forced to '0'); Estimate stays To Do + Actual = 5.00.
      expect(call?.[1]).not.toHaveProperty('todoHours', '0');
      expect(call?.[1]).toMatchObject({ estimateHours: '5.00' });
    });
  });

  describe('deleteWorkItem', () => {
    it('soft-deletes the work item', async () => {
      workItemRepo.findById.mockResolvedValue(mockWorkItem());

      await service.deleteWorkItem(mockActor, 'wi-1');

      expect(workItemRepo.softDelete).toHaveBeenCalledWith('wi-1', 'ws-1');
    });

    it('throws when work item not found', async () => {
      workItemRepo.findById.mockResolvedValue(null);
      await expect(service.deleteWorkItem(mockActor, 'missing')).rejects.toThrow(NotFoundException);
    });

    it('refuses to delete a defect (BA P3.4 — resolve via Closed state instead)', async () => {
      workItemRepo.findById.mockResolvedValue(
        mockWorkItem({ type: 'defect', defectState: 'open' }),
      );

      await expect(service.deleteWorkItem(mockActor, 'wi-1')).rejects.toThrow(
        PreconditionFailedException,
      );
      expect(workItemRepo.softDelete).not.toHaveBeenCalled();
    });
  });

  // ── Relations (F6) ─────────────────────────────────────────────────────────

  describe('linkWorkItem', () => {
    it('rejects linking an item to itself', async () => {
      workItemRepo.findById.mockResolvedValue(mockWorkItem({ id: 'wi-1' }));
      await expect(service.linkWorkItem(mockActor, 'wi-1', 'wi-1', 'blocks')).rejects.toThrow(
        PreconditionFailedException,
      );
      expect(relationRepo.create).not.toHaveBeenCalled();
    });

    it('rejects a duplicate relation', async () => {
      workItemRepo.findById.mockResolvedValue(mockWorkItem());
      relationRepo.exists.mockResolvedValue(true);
      await expect(service.linkWorkItem(mockActor, 'wi-1', 'wi-2', 'relates_to')).rejects.toThrow(
        PreconditionFailedException,
      );
      expect(relationRepo.create).not.toHaveBeenCalled();
    });

    it('rejects a relation that would create a dependency cycle (blocks)', async () => {
      workItemRepo.findById.mockResolvedValue(mockWorkItem());
      relationRepo.exists.mockResolvedValue(false);
      relationRepo.wouldCreateCycle.mockResolvedValue(true);
      await expect(service.linkWorkItem(mockActor, 'wi-1', 'wi-2', 'blocks')).rejects.toThrow(
        PreconditionFailedException,
      );
      expect(relationRepo.create).not.toHaveBeenCalled();
    });

    it('does NOT cycle-check associative relations (relates_to)', async () => {
      workItemRepo.findById.mockResolvedValue(mockWorkItem());
      relationRepo.exists.mockResolvedValue(false);
      await service.linkWorkItem(mockActor, 'wi-1', 'wi-2', 'relates_to');
      expect(relationRepo.wouldCreateCycle).not.toHaveBeenCalled();
      expect(relationRepo.create).toHaveBeenCalled();
    });

    it('creates the relation and returns the refreshed list', async () => {
      workItemRepo.findById.mockResolvedValue(mockWorkItem());
      relationRepo.exists.mockResolvedValue(false);
      relationRepo.listForItem.mockResolvedValue([{ id: 'rel-1' }]);
      const result = await service.linkWorkItem(mockActor, 'wi-1', 'wi-2', 'depends_on');
      expect(relationRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceItemId: 'wi-1',
          targetItemId: 'wi-2',
          relationType: 'depends_on',
        }),
        'ws-1',
      );
      expect(result).toEqual([{ id: 'rel-1' }]);
    });
  });

  describe('unlinkWorkItem', () => {
    it('throws when the relation does not exist', async () => {
      workItemRepo.findById.mockResolvedValue(mockWorkItem());
      relationRepo.findById.mockResolvedValue(null);
      await expect(service.unlinkWorkItem(mockActor, 'wi-1', 'rel-x')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('deletes a relation that touches the item', async () => {
      workItemRepo.findById.mockResolvedValue(mockWorkItem({ id: 'wi-1' }));
      relationRepo.findById.mockResolvedValue({
        id: 'rel-1',
        sourceItemId: 'wi-1',
        targetItemId: 'wi-2',
        relationType: 'blocks',
      });
      await service.unlinkWorkItem(mockActor, 'wi-1', 'rel-1');
      expect(relationRepo.delete).toHaveBeenCalledWith('rel-1', 'ws-1');
    });
  });

  // ── project-scoped write authorization ─────────────────────────────────────
  // Writes are gated per PROJECT (the item's own project), not workspace-wide.
  describe('project-scoped write enforcement', () => {
    it('authorizes a create against the target project', async () => {
      workItemRepo.create.mockResolvedValue(mockWorkItem());
      await service.createWorkItem(mockActor, 'proj-1', 'story', 'Title');
      expect(accessService.assertProjectPermission).toHaveBeenCalledWith(
        mockActor,
        'proj-1',
        'work_item:create',
      );
    });

    it('authorizes an edit against the item’s own project and rejects when denied', async () => {
      workItemRepo.findById.mockResolvedValue(mockWorkItem({ projectId: 'proj-9' }));
      const denied = new Error('PROJECT_PERMISSION_DENIED');
      accessService.assertProjectPermission.mockRejectedValueOnce(denied);

      await expect(service.updateWorkItem(mockActor, 'wi-1', { title: 'x' })).rejects.toThrow(
        denied,
      );
      expect(accessService.assertProjectPermission).toHaveBeenCalledWith(
        mockActor,
        'proj-9',
        'work_item:edit',
      );
      // Denied before any write.
      expect(workItemRepo.update).not.toHaveBeenCalled();
    });

    it('authorizes delete with work_item:delete on the item’s project', async () => {
      workItemRepo.findById.mockResolvedValue(mockWorkItem({ projectId: 'proj-9' }));
      await service.deleteWorkItem(mockActor, 'wi-1');
      expect(accessService.assertProjectPermission).toHaveBeenCalledWith(
        mockActor,
        'proj-9',
        'work_item:delete',
      );
    });
  });

  // ── moveWorkItem ──────────────────────────────────────────────────────────

  describe('moveWorkItem', () => {
    it('validates transition and updates statusId', async () => {
      workItemRepo.findById.mockResolvedValue(mockWorkItem({ statusId: 'status-todo' }));
      workItemRepo.update.mockResolvedValue(mockWorkItem({ statusId: 'status-done' }));

      const result = await service.moveWorkItem(mockActor, 'wi-1', 'status-done');

      expect(projectsService.assertTransitionAllowed).toHaveBeenCalledWith(
        'proj-1',
        'status-todo',
        'status-done',
      );
      expect(workItemRepo.update).toHaveBeenCalledWith(
        'wi-1',
        expect.objectContaining({ statusId: 'status-done', updatedBy: 'user-1' }),
        'ws-1',
        expect.anything(),
      );
      expect(result.statusId).toBe('status-done');
    });
  });

  // ── reorderWorkItems ───────────────────────────────────────────────────────

  describe('reorderWorkItems', () => {
    it('skips when items array is empty', async () => {
      await service.reorderWorkItems(mockActor, []);
      expect(workItemRepo.reorderItems).not.toHaveBeenCalled();
    });

    it('validates each item belongs to workspace before reordering', async () => {
      workItemRepo.findById.mockResolvedValue(mockWorkItem());
      await service.reorderWorkItems(mockActor, [{ id: 'wi-1', rank: 'b1' }]);
      expect(workItemRepo.reorderItems).toHaveBeenCalledWith(
        [{ id: 'wi-1', rank: 'b1' }],
        'ws-1',
        expect.anything(),
      );
    });
  });

  // ── labels ────────────────────────────────────────────────────────────────

  describe('label management', () => {
    beforeEach(() => {
      workItemRepo.findById.mockResolvedValue(mockWorkItem());
    });

    it('getWorkItemLabels returns labels for work item', async () => {
      workItemRepo.listLabels.mockResolvedValue([{ id: 'l1', name: 'bug', color: '#f00' }]);
      const result = await service.getWorkItemLabels(mockActor, 'wi-1');
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('bug');
    });

    it('addLabelToWorkItem adds label', async () => {
      await service.addLabelToWorkItem(mockActor, 'wi-1', 'l1');
      expect(workItemRepo.addLabel).toHaveBeenCalledWith('wi-1', 'l1', 'ws-1');
    });

    it('addLabelToWorkItem validates label belongs to project (P1-15)', async () => {
      projectsService.assertLabelBelongsToProject.mockRejectedValueOnce(
        new Error('LABEL_NOT_IN_PROJECT'),
      );
      await expect(service.addLabelToWorkItem(mockActor, 'wi-1', 'bad-label')).rejects.toThrow(
        'LABEL_NOT_IN_PROJECT',
      );
    });

    it('removeLabelFromWorkItem removes label', async () => {
      await service.removeLabelFromWorkItem(mockActor, 'wi-1', 'l1');
      expect(workItemRepo.removeLabel).toHaveBeenCalledWith('wi-1', 'l1', 'ws-1');
    });
  });

  // ── P1-15 scope validation ────────────────────────────────────────────────

  describe('P1-15 scope validation', () => {
    it('createWorkItem validates assignee is workspace member', async () => {
      projectsService.assertWorkspaceMember.mockRejectedValueOnce(new Error('ASSIGNEE_NOT_MEMBER'));
      await expect(
        service.createWorkItem(mockActor, 'proj-1', 'story', 'Story', {
          assigneeId: 'not-a-member',
        }),
      ).rejects.toThrow('ASSIGNEE_NOT_MEMBER');
    });

    it('updateWorkItem validates new assignee is workspace member', async () => {
      workItemRepo.findById.mockResolvedValue(mockWorkItem());
      projectsService.assertWorkspaceMember.mockRejectedValueOnce(new Error('ASSIGNEE_NOT_MEMBER'));
      await expect(
        service.updateWorkItem(mockActor, 'wi-1', { assigneeId: 'outsider' }),
      ).rejects.toThrow('ASSIGNEE_NOT_MEMBER');
    });

    it('createWorkItem validates parentId belongs to same project', async () => {
      workItemRepo.findById.mockResolvedValueOnce(null); // first call: parent not found
      await expect(
        service.createWorkItem(mockActor, 'proj-1', 'story', 'Story', {
          parentId: 'bad-parent',
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── Phase 2: inline scope validation ─────────────────────────────────────

  describe('inline assignment scope validation', () => {
    it('rejects iteration from a different project', async () => {
      workItemRepo.findById.mockResolvedValue(mockWorkItem({ projectId: 'proj-1' }));
      workItemRepo.findIterationScope.mockResolvedValue({ projectId: 'proj-2', teamId: null });
      await expect(
        service.updateWorkItem(mockActor, 'wi-1', { iterationId: 'it-x' }),
      ).rejects.toThrow(PreconditionFailedException);
    });

    it('rejects a team-scoped iteration whose team differs from the item team', async () => {
      workItemRepo.findById.mockResolvedValue(mockWorkItem({ teamId: 'team-a' }));
      workItemRepo.findIterationScope.mockResolvedValue({
        projectId: 'proj-1',
        teamId: 'team-b',
      });
      await expect(
        service.updateWorkItem(mockActor, 'wi-1', { iterationId: 'it-x' }),
      ).rejects.toThrow(PreconditionFailedException);
    });

    it('allows a team-agnostic iteration onto any team item', async () => {
      workItemRepo.findById.mockResolvedValue(mockWorkItem({ teamId: 'team-a' }));
      workItemRepo.findIterationScope.mockResolvedValue({ projectId: 'proj-1', teamId: null });
      workItemRepo.update.mockResolvedValue(mockWorkItem({ iterationId: 'it-x' }));
      const res = await service.updateWorkItem(mockActor, 'wi-1', { iterationId: 'it-x' });
      expect(res.iterationId).toBe('it-x');
    });

    it('rejects a release from another project', async () => {
      workItemRepo.findById.mockResolvedValue(mockWorkItem({ projectId: 'proj-1' }));
      workItemRepo.findReleaseProject.mockResolvedValue('proj-2');
      await expect(
        service.updateWorkItem(mockActor, 'wi-1', { releaseId: 'rel-x' }),
      ).rejects.toThrow(PreconditionFailedException);
    });

    it('rejects a foundInReleaseId from another project', async () => {
      workItemRepo.findById.mockResolvedValue(mockWorkItem({ projectId: 'proj-1', type: 'defect' }));
      workItemRepo.findReleaseProject.mockResolvedValue('proj-2');
      await expect(
        service.updateWorkItem(mockActor, 'wi-1', { foundInReleaseId: 'rel-x' }),
      ).rejects.toThrow(PreconditionFailedException);
    });

    it('rejects a new reporterId who is not a workspace member', async () => {
      workItemRepo.findById.mockResolvedValue(mockWorkItem({ reporterId: 'user-1' }));
      projectsService.assertWorkspaceMember.mockRejectedValueOnce(new Error('NOT_MEMBER'));
      await expect(
        service.updateWorkItem(mockActor, 'wi-1', { reporterId: 'outsider' }),
      ).rejects.toThrow('NOT_MEMBER');
    });

    it('rejects a new devOwnerId who is not a workspace member', async () => {
      workItemRepo.findById.mockResolvedValue(
        mockWorkItem({ type: 'defect', devOwnerId: null }),
      );
      projectsService.assertWorkspaceMember.mockRejectedValueOnce(new Error('NOT_MEMBER'));
      await expect(
        service.updateWorkItem(mockActor, 'wi-1', { devOwnerId: 'outsider' }),
      ).rejects.toThrow('NOT_MEMBER');
    });

    it('rejects priority edits on stories', async () => {
      workItemRepo.findById.mockResolvedValue(mockWorkItem({ type: 'story' }));
      await expect(service.updateWorkItem(mockActor, 'wi-1', { priority: 'high' })).rejects.toThrow(
        PreconditionFailedException,
      );
    });

    it('rejects reassigning to a team not linked to the project', async () => {
      workItemRepo.findById.mockResolvedValue(mockWorkItem({ projectId: 'proj-1' }));
      projectsService.listProjectTeams.mockResolvedValue([]);
      await expect(
        service.updateWorkItem(mockActor, 'wi-1', { teamId: 'team-x' }),
      ).rejects.toThrow(PreconditionFailedException);
    });

    it('allows reassigning to a team linked to the project', async () => {
      workItemRepo.findById.mockResolvedValue(mockWorkItem({ projectId: 'proj-1' }));
      projectsService.listProjectTeams.mockResolvedValue([{ teamId: 'team-x', status: 'active' }]);
      workItemRepo.update.mockResolvedValue(mockWorkItem({ teamId: 'team-x' }));
      const res = await service.updateWorkItem(mockActor, 'wi-1', { teamId: 'team-x' });
      expect(res.teamId).toBe('team-x');
    });
  });

  // ── Phase 2: bulk assignment (all-or-nothing) ────────────────────────────

  describe('bulkAssignIteration', () => {
    it('fails the whole request if any item is missing', async () => {
      workItemRepo.findByIds.mockResolvedValue([mockWorkItem({ id: 'a' })]); // asked for 2
      await expect(
        service.bulkAssignIteration(mockActor, 'proj-1', ['a', 'b'], 'it-1'),
      ).rejects.toThrow(NotFoundException);
      expect(workItemRepo.assignIteration).not.toHaveBeenCalled();
    });

    it('rejects non-story/defect items', async () => {
      workItemRepo.findByIds.mockResolvedValue([
        mockWorkItem({ id: 'a', type: 'story' }),
        mockWorkItem({ id: 'b', type: 'task' }),
      ]);
      await expect(
        service.bulkAssignIteration(mockActor, 'proj-1', ['a', 'b'], 'it-1'),
      ).rejects.toThrow(PreconditionFailedException);
      expect(workItemRepo.assignIteration).not.toHaveBeenCalled();
    });

    it('rejects if an item is out of the given project', async () => {
      workItemRepo.findByIds.mockResolvedValue([mockWorkItem({ id: 'a', projectId: 'proj-2' })]);
      await expect(service.bulkAssignIteration(mockActor, 'proj-1', ['a'], null)).rejects.toThrow(
        PreconditionFailedException,
      );
    });

    it('unassigns (null) without touching iteration scope lookup', async () => {
      workItemRepo.findByIds.mockResolvedValue([mockWorkItem({ id: 'a', type: 'story' })]);
      const n = await service.bulkAssignIteration(mockActor, 'proj-1', ['a'], null);
      expect(n).toBe(1);
      expect(workItemRepo.findIterationScope).not.toHaveBeenCalled();
      expect(workItemRepo.assignIteration).toHaveBeenCalledWith(
        ['a'],
        null,
        'ws-1',
        'user-1',
        expect.anything(),
      );
    });

    it('assigns a valid iteration to all items', async () => {
      workItemRepo.findByIds.mockResolvedValue([
        mockWorkItem({ id: 'a', type: 'story' }),
        mockWorkItem({ id: 'b', type: 'defect' }),
      ]);
      workItemRepo.findIterationScope.mockResolvedValue({ projectId: 'proj-1', teamId: null });
      const n = await service.bulkAssignIteration(mockActor, 'proj-1', ['a', 'b'], 'it-1');
      expect(n).toBe(2);
      expect(workItemRepo.assignIteration).toHaveBeenCalledWith(
        ['a', 'b'],
        'it-1',
        'ws-1',
        'user-1',
        expect.anything(),
      );
    });
  });

  describe('bulkAssignRelease', () => {
    it('rejects a release from another project', async () => {
      workItemRepo.findByIds.mockResolvedValue([mockWorkItem({ id: 'a' })]);
      workItemRepo.findReleaseProject.mockResolvedValue('proj-2');
      await expect(service.bulkAssignRelease(mockActor, 'proj-1', ['a'], 'rel-1')).rejects.toThrow(
        PreconditionFailedException,
      );
      expect(workItemRepo.assignRelease).not.toHaveBeenCalled();
    });

    it('assigns a valid release', async () => {
      workItemRepo.findByIds.mockResolvedValue([mockWorkItem({ id: 'a' })]);
      workItemRepo.findReleaseProject.mockResolvedValue('proj-1');
      const n = await service.bulkAssignRelease(mockActor, 'proj-1', ['a'], 'rel-1');
      expect(n).toBe(1);
      expect(workItemRepo.assignRelease).toHaveBeenCalled();
    });
  });

  // ── Phase 2: neighbour rank ──────────────────────────────────────────────

  describe('rankWorkItem', () => {
    it('computes a rank between two neighbours', async () => {
      workItemRepo.findById.mockResolvedValue(mockWorkItem({ id: 'wi-1', rank: 'zzz' }));
      workItemRepo.findByIds.mockResolvedValue([
        mockWorkItem({ id: 'before', rank: 'a' }),
        mockWorkItem({ id: 'after', rank: 'c' }),
      ]);
      workItemRepo.update.mockImplementation((_id, input) =>
        Promise.resolve(mockWorkItem({ id: 'wi-1', rank: input.rank })),
      );
      const res = await service.rankWorkItem(mockActor, 'wi-1', {
        projectId: 'proj-1',
        beforeId: 'before',
        afterId: 'after',
      });
      expect(res.rank > 'a' && res.rank < 'c').toBe(true);
    });

    it('appends to the end when afterId is null', async () => {
      workItemRepo.findById.mockResolvedValue(mockWorkItem({ id: 'wi-1' }));
      workItemRepo.findByIds.mockResolvedValue([mockWorkItem({ id: 'before', rank: 'm' })]);
      workItemRepo.update.mockImplementation((_id, input) =>
        Promise.resolve(mockWorkItem({ id: 'wi-1', rank: input.rank })),
      );
      const res = await service.rankWorkItem(mockActor, 'wi-1', {
        projectId: 'proj-1',
        beforeId: 'before',
        afterId: null,
      });
      expect(res.rank > 'm').toBe(true);
    });

    it('rejects a neighbour from a different project', async () => {
      workItemRepo.findById.mockResolvedValue(mockWorkItem({ id: 'wi-1' }));
      workItemRepo.findByIds.mockResolvedValue([
        mockWorkItem({ id: 'before', projectId: 'proj-2', rank: 'a' }),
      ]);
      await expect(
        service.rankWorkItem(mockActor, 'wi-1', {
          projectId: 'proj-1',
          beforeId: 'before',
          afterId: null,
        }),
      ).rejects.toThrow(PreconditionFailedException);
    });

    it('rejects when neighbours are out of order (stale view)', async () => {
      workItemRepo.findById.mockResolvedValue(mockWorkItem({ id: 'wi-1' }));
      workItemRepo.findByIds.mockResolvedValue([
        mockWorkItem({ id: 'before', rank: 'c' }),
        mockWorkItem({ id: 'after', rank: 'a' }),
      ]);
      await expect(
        service.rankWorkItem(mockActor, 'wi-1', {
          projectId: 'proj-1',
          beforeId: 'before',
          afterId: 'after',
        }),
      ).rejects.toThrow(PreconditionFailedException);
    });
  });
});
