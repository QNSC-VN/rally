import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { WorkItemsService } from './work-items.service';
import { WORK_ITEM_REPOSITORY } from '../domain/ports/work-item.repository';
import { ActivityLogger } from '@modules/activity';
import { TIME_LOG_REPOSITORY } from '../domain/ports/time-log.repository';
import { WATCHER_REPOSITORY } from '../domain/ports/watcher.repository';
import { ATTACHMENT_REPOSITORY, EntityAttachmentsService } from '@modules/attachments';
import { WORK_ITEM_RELATION_REPOSITORY } from '../domain/ports/work-item-relation.repository';
import { NotificationSchedulerService } from '@platform/notifications/notification-scheduler.service';
import { AttachmentsService } from '@modules/attachments';
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
  featureId: null,
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
  findPortfolioItemLinkTarget: vi.fn().mockResolvedValue({ type: 'feature', archived: false }),
  assignIteration: vi.fn().mockResolvedValue(undefined),
  assignRelease: vi.fn().mockResolvedValue(undefined),
  listByProject: vi.fn(),
  listBacklog: vi.fn(),
  listTasksByParent: vi.fn(),
  lockRankScope: vi.fn().mockResolvedValue(undefined),
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
  deleteForItem: vi.fn().mockResolvedValue(undefined),
  wouldCreateCycle: vi.fn().mockResolvedValue(false),
});

const makeActivityRepo = () => ({
  build: vi.fn(
    (
      subject: {
        workspaceId: string;
        projectId: string;
        entityType: string;
        entityId: string;
        contextId?: string | null;
      },
      actorId: string | null,
      action: string,
      changes: unknown = null,
      metadata: Record<string, unknown> = {},
    ) => ({
      id: 'act',
      workspaceId: subject.workspaceId,
      projectId: subject.projectId,
      entityType: subject.entityType,
      entityId: subject.entityId,
      contextId: subject.contextId ?? null,
      actorId,
      action,
      changes,
      metadata,
    }),
  ),
  buildDiff: vi.fn(() => []),
  log: vi.fn().mockResolvedValue(undefined),
  logSafe: vi.fn().mockResolvedValue(undefined),
  listFor: vi.fn().mockResolvedValue({ data: [], total: 0, page: 1, pageSize: 50 }),
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

// Link table only — blob metadata now lives in storage.files behind AttachmentsService.
// Keyed by the entity pair since 0083.
const makeAttachmentRepo = () => ({
  listByEntity: vi.fn().mockResolvedValue([]),
  countByEntity: vi.fn().mockResolvedValue(0),
  findByEntityAndFile: vi.fn().mockResolvedValue(null),
  link: vi.fn().mockResolvedValue(undefined),
  unlink: vi.fn().mockResolvedValue(undefined),
});

const makeAttachmentsService = () => ({
  presign: vi.fn().mockResolvedValue({
    fileId: 'file-1',
    uploadUrl: 'https://bucket.example.com/upload',
    requiredHeaders: {},
  }),
  confirm: vi.fn().mockResolvedValue({
    id: 'file-1',
    filename: 'f.txt',
    mimeType: 'text/plain',
    sizeBytes: 1024,
    uploadedBy: 'user-1',
    createdAt: new Date(),
  }),
  getDownloadUrl: vi
    .fn()
    .mockResolvedValue({ url: 'https://bucket.example.com/get', expiresInSeconds: 900 }),
  softDelete: vi.fn().mockResolvedValue(undefined),
  findById: vi.fn().mockResolvedValue(null),
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
  let attachmentsService: ReturnType<typeof makeAttachmentsService>;
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
    attachmentsService = makeAttachmentsService();
    relationRepo = makeRelationRepo();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkItemsService,
        { provide: WORK_ITEM_REPOSITORY, useValue: workItemRepo },
        { provide: ActivityLogger, useValue: activityRepo },
        { provide: TIME_LOG_REPOSITORY, useValue: timeLogRepo },
        { provide: WATCHER_REPOSITORY, useValue: watcherRepo },
        EntityAttachmentsService,
        { provide: ATTACHMENT_REPOSITORY, useValue: attachmentRepo },
        { provide: WORK_ITEM_RELATION_REPOSITORY, useValue: relationRepo },
        {
          provide: NotificationSchedulerService,
          useValue: { schedule: vi.fn().mockResolvedValue(undefined) },
        },
        { provide: AttachmentsService, useValue: attachmentsService },
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

    // ── Work-item hierarchy rules (DB design §Work item hierarchy / §19.3):
    //    Initiative → Feature → Story → { Task, Defect }; a defect's parent is a
    //    user story; a task's parent is a story or defect. ──
    it('rejects creating a defect under a non-story parent', async () => {
      workItemRepo.findById.mockResolvedValue(mockWorkItem({ id: 'feat-1', type: 'task' }));
      await expect(
        service.createWorkItem(mockActor, 'proj-1', 'defect', 'Bug', { parentId: 'feat-1' }),
      ).rejects.toThrow(/user story/i);
      expect(workItemRepo.create).not.toHaveBeenCalled();
    });

    it('allows creating a defect under a story parent', async () => {
      workItemRepo.findById.mockResolvedValue(mockWorkItem({ id: 'story-1', type: 'story' }));
      workItemRepo.create.mockResolvedValue(mockWorkItem({ type: 'defect', parentId: 'story-1' }));
      await service.createWorkItem(mockActor, 'proj-1', 'defect', 'Bug', { parentId: 'story-1' });
      expect(workItemRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ parentId: 'story-1' }),
        expect.anything(),
      );
    });

    it.each(['story', 'defect'] as const)(
      'allows creating a task under a %s parent',
      async (parentType) => {
        workItemRepo.findById.mockResolvedValue(mockWorkItem({ id: 'p-1', type: parentType }));
        workItemRepo.create.mockResolvedValue(mockWorkItem({ type: 'task', parentId: 'p-1' }));
        await service.createWorkItem(mockActor, 'proj-1', 'task', 'T', { parentId: 'p-1' });
        expect(workItemRepo.create).toHaveBeenCalled();
      },
    );

    it.each(['task'] as const)('rejects creating a task under a %s parent', async (parentType) => {
      workItemRepo.findById.mockResolvedValue(mockWorkItem({ id: 'p-1', type: parentType }));
      await expect(
        service.createWorkItem(mockActor, 'proj-1', 'task', 'T', { parentId: 'p-1' }),
      ).rejects.toThrow(/user story or defect/i);
      expect(workItemRepo.create).not.toHaveBeenCalled();
    });

    it('rejects creating a task with no parent', async () => {
      await expect(service.createWorkItem(mockActor, 'proj-1', 'task', 'T')).rejects.toThrow(
        /must be created under a user story or defect/i,
      );
      expect(workItemRepo.create).not.toHaveBeenCalled();
    });

    it.each(['story'] as const)(
      'rejects giving a %s a parent (only tasks and defects have parents)',
      async (childType) => {
        workItemRepo.findById.mockResolvedValue(mockWorkItem({ id: 'p-1', type: 'story' }));
        await expect(
          service.createWorkItem(mockActor, 'proj-1', childType, 'X', { parentId: 'p-1' }),
        ).rejects.toThrow(/only defects and tasks/i);
        expect(workItemRepo.create).not.toHaveBeenCalled();
      },
    );

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

    // ── Real Rally: Estimate is an independent planned value (client-set), not
    //    derived. To Do / Actuals are independent too. ──
    it('persists the client-supplied Estimate independently of To Do / Actual', async () => {
      workItemRepo.findById.mockResolvedValue(
        mockWorkItem({ id: 'parent-1', projectId: 'proj-1', teamId: 'team-p' }),
      );
      projectsService.listProjectTeams.mockResolvedValue([{ teamId: 'team-p', status: 'active' }]);
      workItemRepo.create.mockResolvedValue(mockWorkItem({ type: 'task' }));

      await service.createTask(mockActor, 'parent-1', 'My task', {
        estimateHours: '8',
        todoHours: '3',
        actualHours: '2',
      });

      expect(workItemRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ estimateHours: '8', todoHours: '3', actualHours: '2' }),
        expect.anything(),
      );
    });

    // ── Real Rally: To Do defaults to the Estimate on create when not given ──
    it('defaults To Do to the Estimate when To Do is not provided', async () => {
      workItemRepo.findById.mockResolvedValue(
        mockWorkItem({ id: 'parent-1', projectId: 'proj-1', teamId: 'team-p' }),
      );
      projectsService.listProjectTeams.mockResolvedValue([{ teamId: 'team-p', status: 'active' }]);
      workItemRepo.create.mockResolvedValue(mockWorkItem({ type: 'task' }));

      await service.createTask(mockActor, 'parent-1', 'My task', { estimateHours: '8' });

      expect(workItemRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ estimateHours: '8', todoHours: '8' }),
        expect.anything(),
      );
    });

    it.each(['task'] as const)(
      'rejects creating a task under a %s (parent must be a story or defect)',
      async (parentType) => {
        workItemRepo.findById.mockResolvedValue(mockWorkItem({ id: 'p-1', type: parentType }));
        await expect(service.createTask(mockActor, 'p-1', 'T')).rejects.toThrow(
          /user story or defect/i,
        );
        expect(workItemRepo.create).not.toHaveBeenCalled();
      },
    );

    it('allows creating a task under a defect', async () => {
      workItemRepo.findById.mockResolvedValue(
        mockWorkItem({ id: 'de-1', type: 'defect', projectId: 'proj-1' }),
      );
      workItemRepo.create.mockResolvedValue(mockWorkItem({ type: 'task', parentId: 'de-1' }));
      await service.createTask(mockActor, 'de-1', 'T');
      expect(workItemRepo.create).toHaveBeenCalled();
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

    describe('linking a Story to a Feature', () => {
      // `feature_id` is what every portfolio rollup and capacity metric aggregates by, and until
      // now only the demo seed could set it — the field was readable and writable nowhere.
      beforeEach(() => {
        workItemRepo.findById.mockResolvedValue(mockWorkItem());
        workItemRepo.update.mockResolvedValue(mockWorkItem({ featureId: 'fe-1' }));
        workItemRepo.findPortfolioItemLinkTarget.mockResolvedValue({
          type: 'feature',
          archived: false,
        });
      });

      it('links a Story to an active Feature', async () => {
        const result = await service.updateWorkItem(mockActor, 'wi-1', { featureId: 'fe-1' });
        expect(result.featureId).toBe('fe-1');
        expect(workItemRepo.update).toHaveBeenCalledWith(
          'wi-1',
          expect.objectContaining({ featureId: 'fe-1' }),
          expect.anything(),
          expect.anything(),
        );
      });

      it('unlinks on null WITHOUT looking anything up', async () => {
        // There is nothing to validate about the absence of a link.
        await service.updateWorkItem(mockActor, 'wi-1', { featureId: null });
        expect(workItemRepo.findPortfolioItemLinkTarget).not.toHaveBeenCalled();
      });

      it('refuses an EPIC', async () => {
        // Rally attaches the story hierarchy to the LOWEST portfolio level. Our rollup counts an
        // Epic's children through its Features, so a story pointed straight at an Epic would be
        // counted by the Epic and by nothing else.
        workItemRepo.findPortfolioItemLinkTarget.mockResolvedValue({
          type: 'epic',
          archived: false,
        });
        await expect(
          service.updateWorkItem(mockActor, 'wi-1', { featureId: 'ep-1' }),
        ).rejects.toMatchObject({ code: 'WORK_ITEM_FEATURE_LINK_NOT_FEATURE' });
      });

      it('refuses an ARCHIVED Feature', async () => {
        // Archived Features are hidden from every portfolio surface, so work linked to one would
        // roll up into a row nobody can see.
        workItemRepo.findPortfolioItemLinkTarget.mockResolvedValue({
          type: 'feature',
          archived: true,
        });
        await expect(
          service.updateWorkItem(mockActor, 'wi-1', { featureId: 'fe-1' }),
        ).rejects.toMatchObject({ code: 'WORK_ITEM_FEATURE_LINK_ARCHIVED' });
      });

      it('refuses a TASK, which inherits the link from its work product', async () => {
        workItemRepo.findById.mockResolvedValue(mockWorkItem({ type: 'task' }));
        await expect(
          service.updateWorkItem(mockActor, 'wi-1', { featureId: 'fe-1' }),
        ).rejects.toMatchObject({ code: 'WORK_ITEM_FEATURE_LINK_NOT_ALLOWED' });
        // Refused before the lookup: the item type alone decides it.
        expect(workItemRepo.findPortfolioItemLinkTarget).not.toHaveBeenCalled();
      });

      it('404s a Feature that does not exist', async () => {
        workItemRepo.findPortfolioItemLinkTarget.mockResolvedValue(null);
        await expect(
          service.updateWorkItem(mockActor, 'wi-1', { featureId: 'nope' }),
        ).rejects.toMatchObject({ code: 'PORTFOLIO_ITEM_NOT_FOUND' });
      });

      it('does NOT require the Feature to be in the same project', async () => {
        // Rally lets a team project's Story roll up to a portfolio project's Feature, and the
        // portfolio rollup matches on `feature_id` alone — the project+release filter is Rally's
        // CAPACITY rule, not its portfolio rule.
        await expect(
          service.updateWorkItem(mockActor, 'wi-1', { featureId: 'fe-elsewhere' }),
        ).resolves.toBeDefined();
      });
    });

    describe('unblocking clears the Blocked Reason', () => {
      // Rally: "When a blocked status is removed, the Blocked Reason field is cleared."
      // A reason that outlives its block claims the item is blocked for that reason, right
      // next to a flag saying it is not — and the inline cell is only editable WHILE blocked,
      // so the stale text could be read and never removed.
      const blocked = () =>
        mockWorkItem({ isBlocked: true, blockedReason: 'Waiting on the vendor' });

      it('clears it when isBlocked goes false', async () => {
        workItemRepo.findById.mockResolvedValue(blocked());
        workItemRepo.update.mockResolvedValue(mockWorkItem({ isBlocked: false }));

        await service.updateWorkItem(mockActor, 'wi-1', { isBlocked: false });

        expect(workItemRepo.update).toHaveBeenCalledWith(
          'wi-1',
          expect.objectContaining({ isBlocked: false, blockedReason: null }),
          expect.anything(),
          expect.anything(),
        );
      });

      it('clears it even when the SAME patch sends a reason', async () => {
        // The two cannot both be true, so `isBlocked: false` wins rather than the write order
        // deciding it.
        workItemRepo.findById.mockResolvedValue(blocked());
        workItemRepo.update.mockResolvedValue(mockWorkItem({ isBlocked: false }));

        await service.updateWorkItem(mockActor, 'wi-1', {
          isBlocked: false,
          blockedReason: 'Still stuck',
        });

        expect(workItemRepo.update).toHaveBeenCalledWith(
          'wi-1',
          expect.objectContaining({ blockedReason: null }),
          expect.anything(),
          expect.anything(),
        );
      });

      it('leaves the reason alone when BLOCKING', async () => {
        workItemRepo.findById.mockResolvedValue(mockWorkItem());
        workItemRepo.update.mockResolvedValue(mockWorkItem({ isBlocked: true }));

        await service.updateWorkItem(mockActor, 'wi-1', {
          isBlocked: true,
          blockedReason: 'Waiting on the vendor',
        });

        expect(workItemRepo.update).toHaveBeenCalledWith(
          'wi-1',
          expect.objectContaining({ blockedReason: 'Waiting on the vendor' }),
          expect.anything(),
          expect.anything(),
        );
      });

      it('does not touch the reason on an unrelated edit', async () => {
        // A title change on a blocked item must not unblock anything by side effect.
        workItemRepo.findById.mockResolvedValue(blocked());
        workItemRepo.update.mockResolvedValue(blocked());

        await service.updateWorkItem(mockActor, 'wi-1', { title: 'Renamed' });

        const patch = workItemRepo.update.mock.calls[0][1] as Record<string, unknown>;
        expect('blockedReason' in patch).toBe(false);
      });
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

    it('reverts an Accepted parent to In-Progress when a child task reopens (P3-TS-FR-041; Accepted is not exempt)', async () => {
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

      expect(workItemRepo.update).toHaveBeenCalledWith(
        'parent-1',
        expect.objectContaining({ scheduleState: 'in_progress' }),
        'ws-1',
        expect.anything(),
      );
    });

    // ── Real Rally: Estimate is independent — never derived/overwritten on update ──
    it('does NOT derive or overwrite the Estimate on update', async () => {
      const task = mockWorkItem({
        id: 'task-1',
        type: 'task',
        todoHours: '1',
        actualHours: '1',
        estimateHours: '8',
      });
      workItemRepo.findById.mockResolvedValue(task);
      workItemRepo.update.mockResolvedValue(mockWorkItem({ id: 'task-1', type: 'task' }));

      await service.updateWorkItem(mockActor, 'task-1', { todoHours: '4' });

      const call = workItemRepo.update.mock.calls.find((c) => c[0] === 'task-1');
      // Only To Do changes; Estimate is left entirely to the client.
      expect(call?.[1]).not.toHaveProperty('estimateHours');
      expect(call?.[1]).toMatchObject({ todoHours: '4' });
    });

    /**
     * The BA's first clause, on the UPDATE path: "If the Owner enters `Estimate` first, the system
     * copies the same number of hours to `To Do` once" (Portfolio SRS:143).
     *
     * The create path did this and the update path did not, so estimating a task that already existed
     * left To Do empty and the planner typed the same number twice.
     */
    it('copies a FIRST Estimate into To Do, once', async () => {
      const task = mockWorkItem({ id: 'task-1', type: 'task', todoHours: null });
      workItemRepo.findById.mockResolvedValue(task);
      workItemRepo.update.mockResolvedValue(mockWorkItem({ id: 'task-1', type: 'task' }));

      await service.updateWorkItem(mockActor, 'task-1', { estimateHours: '6' });

      const call = workItemRepo.update.mock.calls.find((c) => c[0] === 'task-1');
      expect(call?.[1]).toMatchObject({ estimateHours: '6', todoHours: '6' });
    });

    it('does NOT re-copy once To Do has a value — including a deliberate 0', async () => {
      // "After that first copy, `Estimate`, `To Do` and `Actual` do not auto-recalculate each other"
      // (SRS:144). `0` is the case worth pinning: a completed task has exactly that, so treating it as
      // "unset" would undo the auto-zero, or overwrite a planner who typed 0 on purpose.
      for (const existingTodo of ['4', '0']) {
        workItemRepo.update.mockClear();
        workItemRepo.findById.mockResolvedValue(
          mockWorkItem({ id: 'task-1', type: 'task', todoHours: existingTodo }),
        );
        workItemRepo.update.mockResolvedValue(mockWorkItem({ id: 'task-1', type: 'task' }));

        await service.updateWorkItem(mockActor, 'task-1', { estimateHours: '9' });

        const call = workItemRepo.update.mock.calls.find((c) => c[0] === 'task-1');
        expect(call?.[1]).toMatchObject({ estimateHours: '9' });
        expect(call?.[1]).not.toHaveProperty('todoHours');
      }
    });

    it('lets the same patch set BOTH, without the copy interfering', async () => {
      workItemRepo.findById.mockResolvedValue(
        mockWorkItem({ id: 'task-1', type: 'task', todoHours: null }),
      );
      workItemRepo.update.mockResolvedValue(mockWorkItem({ id: 'task-1', type: 'task' }));

      await service.updateWorkItem(mockActor, 'task-1', { estimateHours: '8', todoHours: '3' });

      const call = workItemRepo.update.mock.calls.find((c) => c[0] === 'task-1');
      // An explicit To Do wins: the copy is a convenience for the field being LEFT OUT.
      expect(call?.[1]).toMatchObject({ estimateHours: '8', todoHours: '3' });
    });

    // ── Real Rally: completing a task auto-zeroes To Do; Estimate untouched ──
    it('auto-zeroes To Do when a task is completed, leaving Estimate untouched', async () => {
      const task = mockWorkItem({
        id: 'task-1',
        type: 'task',
        scheduleState: 'in_progress',
        todoHours: '3',
        actualHours: '2',
        estimateHours: '8',
        parentId: null,
      });
      workItemRepo.findById.mockResolvedValue(task);
      workItemRepo.update.mockResolvedValue(mockWorkItem({ id: 'task-1', type: 'task' }));

      await service.updateWorkItem(mockActor, 'task-1', { scheduleState: 'completed' });

      const call = workItemRepo.update.mock.calls.find((c) => c[0] === 'task-1');
      expect(call?.[1]).toMatchObject({ todoHours: '0' });
      expect(call?.[1]).not.toHaveProperty('estimateHours');
    });

    // ── Parent reassignment must obey the SAME hierarchy rules as create, so
    //    update can never back-door an invalid parent (the audit's GAP-2). ──
    // findById resolves BOTH the edited item and the candidate parent; route by id.
    const withItemAndParent = (
      item: ReturnType<typeof mockWorkItem>,
      parent: ReturnType<typeof mockWorkItem>,
    ) =>
      workItemRepo.findById.mockImplementation((id: string) =>
        Promise.resolve(id === item.id ? item : parent),
      );

    it('rejects moving a defect under a non-story parent', async () => {
      withItemAndParent(
        mockWorkItem({ id: 'de-1', type: 'defect', parentId: null }),
        mockWorkItem({ id: 'feat-1', type: 'task' }),
      );
      await expect(
        service.updateWorkItem(mockActor, 'de-1', { parentId: 'feat-1' }),
      ).rejects.toThrow(/user story/i);
      expect(workItemRepo.update).not.toHaveBeenCalled();
    });

    it('allows moving a defect under a story parent', async () => {
      withItemAndParent(
        mockWorkItem({ id: 'de-1', type: 'defect', parentId: null }),
        mockWorkItem({ id: 'story-1', type: 'story' }),
      );
      workItemRepo.update.mockResolvedValue(mockWorkItem({ id: 'de-1', type: 'defect' }));
      await service.updateWorkItem(mockActor, 'de-1', { parentId: 'story-1' });
      expect(workItemRepo.update).toHaveBeenCalled();
    });

    it('allows clearing a defect parent (null)', async () => {
      workItemRepo.findById.mockResolvedValue(
        mockWorkItem({ id: 'de-1', type: 'defect', parentId: 'story-1' }),
      );
      workItemRepo.update.mockResolvedValue(mockWorkItem({ id: 'de-1', type: 'defect' }));
      await service.updateWorkItem(mockActor, 'de-1', { parentId: null });
      expect(workItemRepo.update).toHaveBeenCalled();
    });

    it.each(['task'] as const)('rejects moving a task under a %s', async (parentType) => {
      withItemAndParent(
        mockWorkItem({ id: 'task-1', type: 'task', parentId: 'story-0' }),
        mockWorkItem({ id: 'p-1', type: parentType }),
      );
      await expect(
        service.updateWorkItem(mockActor, 'task-1', { parentId: 'p-1' }),
      ).rejects.toThrow(/user story or defect/i);
      expect(workItemRepo.update).not.toHaveBeenCalled();
    });

    it('rejects clearing a task parent (a task must belong to a work product)', async () => {
      workItemRepo.findById.mockResolvedValue(
        mockWorkItem({ id: 'task-1', type: 'task', parentId: 'story-0' }),
      );
      await expect(service.updateWorkItem(mockActor, 'task-1', { parentId: null })).rejects.toThrow(
        /must belong to a work product/i,
      );
      expect(workItemRepo.update).not.toHaveBeenCalled();
    });

    it.each(['story'] as const)(
      'rejects setting a parent on a %s via update (only tasks/defects have parents)',
      async (childType) => {
        withItemAndParent(
          mockWorkItem({ id: 'c-1', type: childType, parentId: null }),
          mockWorkItem({ id: 'p-1', type: 'story' }),
        );
        await expect(service.updateWorkItem(mockActor, 'c-1', { parentId: 'p-1' })).rejects.toThrow(
          /only defects and tasks/i,
        );
        expect(workItemRepo.update).not.toHaveBeenCalled();
      },
    );
  });

  describe('deleteWorkItem', () => {
    it('soft-deletes the work item', async () => {
      workItemRepo.findById.mockResolvedValue(mockWorkItem());

      await service.deleteWorkItem(mockActor, 'wi-1');

      expect(workItemRepo.softDelete).toHaveBeenCalledWith('wi-1', 'ws-1');
    });

    it('removes the item’s relations so none dangle after delete (GAP-8)', async () => {
      workItemRepo.findById.mockResolvedValue(mockWorkItem({ id: 'wi-1', type: 'story' }));

      await service.deleteWorkItem(mockActor, 'wi-1');

      expect(relationRepo.deleteForItem).toHaveBeenCalledWith('wi-1', 'ws-1');
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

    it('rejects the same relation in the reverse direction (GAP-7)', async () => {
      workItemRepo.findById.mockResolvedValue(mockWorkItem());
      // Forward (wi-1 → wi-2) does not exist, but the reverse (wi-2 → wi-1) does.
      relationRepo.exists.mockImplementation((src: string) => Promise.resolve(src === 'wi-2'));
      await expect(service.linkWorkItem(mockActor, 'wi-1', 'wi-2', 'blocks')).rejects.toThrow(
        /opposite direction/i,
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

  // Note: per-route project authorization (create/edit/delete/view) now lives in
  // the PolicyGuard (@RequirePermission on the controller), covered by
  // policy.guard.spec.ts and the work-items e2e authz suite. The service no
  // longer calls assertProjectPermission for its primary route id — only for
  // SECONDARY targets a route-scoped guard cannot see (relation link target) and
  // the multi-project reorder batch, which are asserted in their own describes.

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
      workItemRepo.findById.mockResolvedValue(
        mockWorkItem({ projectId: 'proj-1', type: 'defect' }),
      );
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
      workItemRepo.findById.mockResolvedValue(mockWorkItem({ type: 'defect', devOwnerId: null }));
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
      await expect(service.updateWorkItem(mockActor, 'wi-1', { teamId: 'team-x' })).rejects.toThrow(
        PreconditionFailedException,
      );
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
