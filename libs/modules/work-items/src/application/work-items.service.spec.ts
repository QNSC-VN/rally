import { Test, TestingModule } from '@nestjs/testing';
import { WorkItemsService } from './work-items.service';
import { WORK_ITEM_REPOSITORY } from '../domain/ports/work-item.repository';
import { ACTIVITY_LOG_REPOSITORY } from '../domain/ports/activity-log.repository';
import { TIME_LOG_REPOSITORY } from '../domain/ports/time-log.repository';
import { WATCHER_REPOSITORY } from '../domain/ports/watcher.repository';
import { ATTACHMENT_REPOSITORY } from '../domain/ports/attachment.repository';
import { StorageService } from '@platform';
import type { WorkItem } from '../domain/work-item.types';
import { NotFoundException, PreconditionFailedException, UnitOfWork } from '@platform';
import { ProjectsService } from '@modules/projects';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const now = new Date('2024-06-01');

const mockWorkItem = (o: Partial<WorkItem> = {}): WorkItem => ({
  id: 'wi-1',
  tenantId: 'tenant-1',
  projectId: 'proj-1',
  itemKey: 'PROJ-1',
  type: 'story',
  title: 'Test story',
  description: null,
  statusId: 'status-todo',
  scheduleState: 'defined',
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
  ...o,
});

const mockActor = {
  sub: 'user-1',
  tenantId: 'tenant-1',
  sessionId: 's1',
  jti: 'j1',
  iat: 0,
  exp: 0,
  iss: 'rally',
  aud: 'rally-app',
};

const mockStatus = (id: string, isDefault = false) => ({
  id,
  tenantId: 'tenant-1',
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
  listByProject: vi.fn(),
  listBacklog: vi.fn(),
  listTasksByParent: vi.fn(),
  getTaskTotals: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  softDelete: vi.fn().mockResolvedValue(undefined),
  reorderItems: vi.fn().mockResolvedValue(undefined),
  addLabel: vi.fn().mockResolvedValue(undefined),
  removeLabel: vi.fn().mockResolvedValue(undefined),
  listLabels: vi.fn(),
});

const makeActivityRepo = () => ({
  append: vi.fn().mockResolvedValue(undefined),
  appendMany: vi.fn().mockResolvedValue(undefined),
  listByWorkItem: vi.fn(),
});

const makeUnitOfWork = () => ({
  run: vi.fn(async (cb: (tx: unknown) => unknown) => cb({})),
});

const makeProjectsService = () => ({
  getProject: vi.fn().mockResolvedValue({ id: 'proj-1', tenantId: 'tenant-1' }),
  listStatuses: vi
    .fn()
    .mockResolvedValue([mockStatus('status-todo', true), mockStatus('status-done')]),
  assertTransitionAllowed: vi.fn().mockResolvedValue(undefined),
  generateItemKey: vi.fn().mockResolvedValue('PROJ-42'),
  listProjectTeams: vi.fn().mockResolvedValue([]),
  // P1-15: scope validation helpers
  assertWorkspaceMember: vi.fn().mockResolvedValue(undefined),
  assertLabelBelongsToProject: vi.fn().mockResolvedValue(undefined),
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
  let uow: ReturnType<typeof makeUnitOfWork>;
  let timeLogRepo: ReturnType<typeof makeTimeLogRepo>;
  let watcherRepo: ReturnType<typeof makeWatcherRepo>;
  let attachmentRepo: ReturnType<typeof makeAttachmentRepo>;
  let storageService: ReturnType<typeof makeStorageService>;

  beforeEach(async () => {
    workItemRepo = makeWorkItemRepo();
    activityRepo = makeActivityRepo();
    projectsService = makeProjectsService();
    uow = makeUnitOfWork();
    timeLogRepo = makeTimeLogRepo();
    watcherRepo = makeWatcherRepo();
    attachmentRepo = makeAttachmentRepo();
    storageService = makeStorageService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkItemsService,
        { provide: WORK_ITEM_REPOSITORY, useValue: workItemRepo },
        { provide: ACTIVITY_LOG_REPOSITORY, useValue: activityRepo },
        { provide: TIME_LOG_REPOSITORY, useValue: timeLogRepo },
        { provide: WATCHER_REPOSITORY, useValue: watcherRepo },
        { provide: ATTACHMENT_REPOSITORY, useValue: attachmentRepo },
        { provide: StorageService, useValue: storageService },
        { provide: ProjectsService, useValue: projectsService },
        { provide: UnitOfWork, useValue: uow },
      ],
    }).compile();

    service = module.get(WorkItemsService);
  });

  // ── listWorkItems ──────────────────────────────────────────────────────────

  describe('listWorkItems', () => {
    it('validates project access and returns items', async () => {
      workItemRepo.listByProject.mockResolvedValue({
        items: [mockWorkItem()],
        nextCursor: null,
        total: 1,
      });

      const result = await service.listWorkItems(
        mockActor,
        'proj-1',
        {},
        { limit: 20, cursor: null },
      );

      expect(projectsService.getProject).toHaveBeenCalledWith('tenant-1', 'proj-1');
      expect(result.items).toHaveLength(1);
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
        expect.objectContaining({ statusId: 'status-todo', tenantId: 'tenant-1' }),
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
  });

  // ── getWorkItem ────────────────────────────────────────────────────────────

  describe('getWorkItem', () => {
    it('returns work item when found and belongs to tenant', async () => {
      workItemRepo.findById.mockResolvedValue(mockWorkItem());
      const result = await service.getWorkItem('tenant-1', 'wi-1');
      expect(result.title).toBe('Test story');
    });

    it('throws NotFoundException when not found', async () => {
      workItemRepo.findById.mockResolvedValue(null);
      await expect(service.getWorkItem('tenant-1', 'missing')).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when tenant mismatch', async () => {
      workItemRepo.findById.mockResolvedValue(mockWorkItem({ tenantId: 'other-tenant' }));
      await expect(service.getWorkItem('tenant-1', 'wi-1')).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException for soft-deleted item', async () => {
      workItemRepo.findById.mockResolvedValue(mockWorkItem({ deletedAt: now }));
      await expect(service.getWorkItem('tenant-1', 'wi-1')).rejects.toThrow(NotFoundException);
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
  });

  // ── deleteWorkItem ─────────────────────────────────────────────────────────

  describe('deleteWorkItem', () => {
    it('soft-deletes the work item', async () => {
      workItemRepo.findById.mockResolvedValue(mockWorkItem());

      await service.deleteWorkItem('tenant-1', 'wi-1');

      expect(workItemRepo.softDelete).toHaveBeenCalledWith('wi-1');
    });

    it('throws when work item not found', async () => {
      workItemRepo.findById.mockResolvedValue(null);
      await expect(service.deleteWorkItem('tenant-1', 'missing')).rejects.toThrow(
        NotFoundException,
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
        expect.anything(),
      );
      expect(result.statusId).toBe('status-done');
    });
  });

  // ── reorderWorkItems ───────────────────────────────────────────────────────

  describe('reorderWorkItems', () => {
    it('skips when items array is empty', async () => {
      await service.reorderWorkItems('tenant-1', []);
      expect(workItemRepo.reorderItems).not.toHaveBeenCalled();
    });

    it('validates each item belongs to tenant before reordering', async () => {
      workItemRepo.findById.mockResolvedValue(mockWorkItem());
      await service.reorderWorkItems('tenant-1', [{ id: 'wi-1', rank: 'b1' }]);
      expect(workItemRepo.reorderItems).toHaveBeenCalledWith(
        [{ id: 'wi-1', rank: 'b1' }],
        'tenant-1',
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
      const result = await service.getWorkItemLabels('tenant-1', 'wi-1');
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('bug');
    });

    it('addLabelToWorkItem adds label', async () => {
      await service.addLabelToWorkItem('tenant-1', 'wi-1', 'l1');
      expect(workItemRepo.addLabel).toHaveBeenCalledWith('wi-1', 'l1');
    });

    it('addLabelToWorkItem validates label belongs to project (P1-15)', async () => {
      projectsService.assertLabelBelongsToProject.mockRejectedValueOnce(
        new Error('LABEL_NOT_IN_PROJECT'),
      );
      await expect(service.addLabelToWorkItem('tenant-1', 'wi-1', 'bad-label')).rejects.toThrow(
        'LABEL_NOT_IN_PROJECT',
      );
    });

    it('removeLabelFromWorkItem removes label', async () => {
      await service.removeLabelFromWorkItem('tenant-1', 'wi-1', 'l1');
      expect(workItemRepo.removeLabel).toHaveBeenCalledWith('wi-1', 'l1');
    });
  });

  // ── P1-15 scope validation ────────────────────────────────────────────────

  describe('P1-15 scope validation', () => {
    it('createWorkItem validates assignee is workspace member', async () => {
      projectsService.assertWorkspaceMember.mockRejectedValueOnce(
        new Error('ASSIGNEE_NOT_MEMBER'),
      );
      await expect(
        service.createWorkItem(mockActor, 'proj-1', 'story', 'Story', {
          assigneeId: 'not-a-member',
        }),
      ).rejects.toThrow('ASSIGNEE_NOT_MEMBER');
    });

    it('updateWorkItem validates new assignee is workspace member', async () => {
      workItemRepo.findById.mockResolvedValue(mockWorkItem());
      projectsService.assertWorkspaceMember.mockRejectedValueOnce(
        new Error('ASSIGNEE_NOT_MEMBER'),
      );
      await expect(
        service.updateWorkItem(mockActor, 'wi-1', { assigneeId: 'outsider' }),
      ).rejects.toThrow('ASSIGNEE_NOT_MEMBER');
    });

    it('createWorkItem validates parentId belongs to same project', async () => {
      workItemRepo.findById
        .mockResolvedValueOnce(null) // first call: parent not found
      await expect(
        service.createWorkItem(mockActor, 'proj-1', 'story', 'Story', {
          parentId: 'bad-parent',
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
