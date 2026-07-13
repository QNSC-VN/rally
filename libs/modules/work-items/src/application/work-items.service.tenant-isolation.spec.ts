import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { WorkItemsService } from './work-items.service';
import { WORK_ITEM_REPOSITORY } from '../domain/ports/work-item.repository';
import { ACTIVITY_LOG_REPOSITORY } from '../domain/ports/activity-log.repository';
import { TIME_LOG_REPOSITORY } from '../domain/ports/time-log.repository';
import { WATCHER_REPOSITORY } from '../domain/ports/watcher.repository';
import { ATTACHMENT_REPOSITORY } from '../domain/ports/attachment.repository';
import { StorageService } from '@platform';
import type { WorkItem } from '../domain/work-item.types';
import type { TimeLog } from '../domain/time-log.types';
import type { Attachment } from '../domain/attachment.types';
import { NotFoundException, UnitOfWork } from '@platform';
import { ProjectsService } from '@modules/projects';

// Tenant isolation is enforced at the application layer via `getWorkItem`'s
// `item.tenantId !== tenantId` guard. These tests exercise that boundary
// directly: a caller scoped to tenant B must never be able to read or mutate
// a work item (or its logs/watchers/attachments) that belongs to tenant A,
// and every repository call must carry the caller's own tenantId — never a
// hardcoded or borrowed one.

const now = new Date('2024-06-01');

const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';

const mockWorkItem = (o: Partial<WorkItem> = {}): WorkItem => ({
  id: 'wi-a',
  tenantId: TENANT_A,
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

const mockTimeLog = (o: Partial<TimeLog> = {}): TimeLog => ({
  id: 'log-a',
  tenantId: TENANT_A,
  workItemId: 'wi-a',
  userId: 'user-1',
  loggedDate: '2026-06-25',
  hours: '2',
  description: null,
  createdAt: now,
  updatedAt: now,
  deletedAt: null,
  ...o,
});

const mockAttachment = (o: Partial<Attachment> = {}): Attachment => ({
  id: 'att-a',
  tenantId: TENANT_A,
  workItemId: 'wi-a',
  uploadedBy: 'user-1',
  filename: 'file.txt',
  mimeType: 'text/plain',
  sizeBytes: 100,
  storageKey: `${TENANT_A}/wi-a/att-a`,
  status: 'completed',
  deletedAt: null,
  createdAt: now,
  ...o,
});

const actorForTenant = (tenantId: string) => ({
  sub: 'user-1',
  tenantId,
  sessionId: 's1',
  jti: 'j1',
  iat: 0,
  exp: 0,
  iss: 'rally',
  aud: 'rally-app',
  permissions: [] as string[],
  authMethod: 'password' as const,
});

// findById/findByIds faithfully simulate the SQL `WHERE id = ? AND tenant_id = ?`
// scoping — an item is only visible to its owning tenant, regardless of what
// the caller passes.
const makeScopedWorkItemRepo = (items: WorkItem[]) => ({
  findById: vi.fn((id: string, tenantId: string) =>
    Promise.resolve(items.find((i) => i.id === id && i.tenantId === tenantId) ?? null),
  ),
  findByIds: vi.fn((ids: string[], tenantId: string) =>
    Promise.resolve(items.filter((i) => ids.includes(i.id) && i.tenantId === tenantId)),
  ),
  findIterationScope: vi.fn().mockResolvedValue(null),
  findReleaseProject: vi.fn().mockResolvedValue(null),
  assignIteration: vi.fn().mockResolvedValue(undefined),
  assignRelease: vi.fn().mockResolvedValue(undefined),
  listByProject: vi.fn(),
  listBacklog: vi.fn(),
  listTasksByParent: vi.fn().mockResolvedValue([]),
  findMaxRank: vi.fn().mockResolvedValue(null),
  getTaskTotals: vi.fn(),
  create: vi.fn(),
  update: vi.fn((id: string, patch: Partial<WorkItem>) => Promise.resolve(mockWorkItem({ id, ...patch }))),
  softDelete: vi.fn().mockResolvedValue(undefined),
  reorderItems: vi.fn().mockResolvedValue(undefined),
  addLabel: vi.fn().mockResolvedValue(undefined),
  removeLabel: vi.fn().mockResolvedValue(undefined),
  listLabels: vi.fn().mockResolvedValue([]),
});

const makeScopedTimeLogRepo = (logs: TimeLog[]) => ({
  findById: vi.fn((id: string, tenantId: string) =>
    Promise.resolve(logs.find((l) => l.id === id && l.tenantId === tenantId) ?? null),
  ),
  listByWorkItem: vi.fn().mockResolvedValue({ items: [], total: 0 }),
  create: vi.fn((input: Partial<TimeLog>) => Promise.resolve(mockTimeLog(input))),
  update: vi.fn((id: string, patch: Partial<TimeLog>) => Promise.resolve(mockTimeLog({ id, ...patch }))),
  softDelete: vi.fn().mockResolvedValue(undefined),
});

const makeScopedAttachmentRepo = (attachments: Attachment[]) => ({
  findById: vi.fn((id: string, tenantId: string) =>
    Promise.resolve(attachments.find((a) => a.id === id && a.tenantId === tenantId) ?? null),
  ),
  listByWorkItem: vi.fn().mockResolvedValue([]),
  countByWorkItem: vi.fn().mockResolvedValue(0),
  create: vi.fn((input: Partial<Attachment>) => Promise.resolve(mockAttachment(input))),
  confirm: vi.fn(),
  softDelete: vi.fn().mockResolvedValue(undefined),
});

const makeWatcherRepo = () => ({
  listByWorkItem: vi.fn().mockResolvedValue([]),
  isWatching: vi.fn(),
  watch: vi.fn().mockResolvedValue(undefined),
  unwatch: vi.fn().mockResolvedValue(undefined),
  watchMany: vi.fn().mockResolvedValue(undefined),
  listUserIds: vi.fn(),
});

const makeActivityRepo = () => ({
  append: vi.fn().mockResolvedValue(undefined),
  appendMany: vi.fn().mockResolvedValue(undefined),
  listByWorkItem: vi.fn().mockResolvedValue({ items: [], total: 0 }),
});

const makeUnitOfWork = () => ({
  run: vi.fn(async (cb: (tx: unknown) => unknown) => cb({})),
});

const makeProjectsService = () => ({
  getProject: vi.fn().mockResolvedValue({ id: 'proj-1', tenantId: TENANT_A, workspaceId: 'ws-1' }),
  listStatuses: vi.fn().mockResolvedValue([]),
  assertTransitionAllowed: vi.fn().mockResolvedValue(undefined),
  generateItemKey: vi.fn().mockResolvedValue('PROJ-42'),
  listProjectTeams: vi.fn().mockResolvedValue([]),
  assertWorkspaceMember: vi.fn().mockResolvedValue(undefined),
  assertLabelBelongsToProject: vi.fn().mockResolvedValue(undefined),
});

const makeStorageService = () => ({
  presignPut: vi.fn().mockResolvedValue({ uploadUrl: 'https://s3.example.com/upload' }),
  presignGet: vi.fn().mockResolvedValue('https://s3.example.com/download'),
  headObject: vi.fn().mockResolvedValue({ contentLength: 100 }),
  deleteObject: vi.fn().mockResolvedValue(undefined),
  cdnUrl: vi.fn().mockReturnValue(null),
});

describe('WorkItemsService — tenant isolation', () => {
  let service: WorkItemsService;
  let workItemRepo: ReturnType<typeof makeScopedWorkItemRepo>;
  let timeLogRepo: ReturnType<typeof makeScopedTimeLogRepo>;
  let watcherRepo: ReturnType<typeof makeWatcherRepo>;
  let attachmentRepo: ReturnType<typeof makeScopedAttachmentRepo>;
  let activityRepo: ReturnType<typeof makeActivityRepo>;
  let projectsService: ReturnType<typeof makeProjectsService>;

  const itemA = mockWorkItem({ id: 'wi-a', tenantId: TENANT_A });
  const logA = mockTimeLog({ id: 'log-a', tenantId: TENANT_A, workItemId: 'wi-a' });
  const attachmentA = mockAttachment({ id: 'att-a', tenantId: TENANT_A, workItemId: 'wi-a' });

  const build = async (
    wiRepo: ReturnType<typeof makeScopedWorkItemRepo>,
    tlRepo: ReturnType<typeof makeScopedTimeLogRepo>,
    atRepo: ReturnType<typeof makeScopedAttachmentRepo>,
  ) => {
    activityRepo = makeActivityRepo();
    watcherRepo = makeWatcherRepo();
    projectsService = makeProjectsService();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkItemsService,
        { provide: WORK_ITEM_REPOSITORY, useValue: wiRepo },
        { provide: ACTIVITY_LOG_REPOSITORY, useValue: activityRepo },
        { provide: TIME_LOG_REPOSITORY, useValue: tlRepo },
        { provide: WATCHER_REPOSITORY, useValue: watcherRepo },
        { provide: ATTACHMENT_REPOSITORY, useValue: atRepo },
        { provide: StorageService, useValue: makeStorageService() },
        { provide: ProjectsService, useValue: projectsService },
        { provide: UnitOfWork, useValue: makeUnitOfWork() },
      ],
    }).compile();
    return module.get(WorkItemsService);
  };

  beforeEach(async () => {
    workItemRepo = makeScopedWorkItemRepo([itemA]);
    timeLogRepo = makeScopedTimeLogRepo([logA]);
    attachmentRepo = makeScopedAttachmentRepo([attachmentA]);
    service = await build(workItemRepo, timeLogRepo, attachmentRepo);
  });

  // ── getWorkItem — the central gate ───────────────────────────────────────

  describe('getWorkItem', () => {
    it('reads a work item scoped to its owning tenant', async () => {
      const item = await service.getWorkItem(TENANT_A, 'wi-a');
      expect(item.id).toBe('wi-a');
      expect(workItemRepo.findById).toHaveBeenCalledWith('wi-a', TENANT_A);
    });

    it('cannot fetch a foreign tenant work item by id', async () => {
      await expect(service.getWorkItem(TENANT_B, 'wi-a')).rejects.toThrow(NotFoundException);
      expect(workItemRepo.findById).toHaveBeenCalledWith('wi-a', TENANT_B);
    });

    it('defends in depth: rejects even if the repository leaks a foreign row', async () => {
      const leakyRepo = makeScopedWorkItemRepo([itemA]);
      leakyRepo.findById.mockResolvedValue(itemA); // ignores the tenantId argument
      const leakyService = await build(leakyRepo, timeLogRepo, attachmentRepo);
      await expect(leakyService.getWorkItem(TENANT_B, 'wi-a')).rejects.toThrow(NotFoundException);
    });
  });

  // ── updateWorkItem / deleteWorkItem / moveWorkItem ───────────────────────

  describe('updateWorkItem', () => {
    it('cannot update a foreign tenant work item', async () => {
      await expect(
        service.updateWorkItem(actorForTenant(TENANT_B), 'wi-a', { title: 'hijacked' }),
      ).rejects.toThrow(NotFoundException);
      expect(workItemRepo.update).not.toHaveBeenCalled();
    });

    it('updates using the caller tenantId, not a hardcoded one', async () => {
      await service.updateWorkItem(actorForTenant(TENANT_A), 'wi-a', { title: 'ok' });
      expect(workItemRepo.update).toHaveBeenCalledWith(
        'wi-a',
        expect.objectContaining({ title: 'ok' }),
        TENANT_A,
        expect.anything(),
      );
    });
  });

  describe('deleteWorkItem', () => {
    it('cannot delete a foreign tenant work item', async () => {
      await expect(service.deleteWorkItem(TENANT_B, 'wi-a')).rejects.toThrow(NotFoundException);
      expect(workItemRepo.softDelete).not.toHaveBeenCalled();
    });

    it('soft-deletes using the caller tenantId', async () => {
      await service.deleteWorkItem(TENANT_A, 'wi-a');
      expect(workItemRepo.softDelete).toHaveBeenCalledWith('wi-a', TENANT_A);
    });
  });

  describe('moveWorkItem', () => {
    it('cannot move a foreign tenant work item', async () => {
      await expect(
        service.moveWorkItem(actorForTenant(TENANT_B), 'wi-a', 'status-done'),
      ).rejects.toThrow(NotFoundException);
      expect(workItemRepo.update).not.toHaveBeenCalled();
    });
  });

  // ── createTask (parent lookup is tenant-gated) ───────────────────────────

  describe('createTask', () => {
    it('cannot create a task under a foreign tenant parent', async () => {
      await expect(
        service.createTask(actorForTenant(TENANT_B), 'wi-a', 'Subtask'),
      ).rejects.toThrow(NotFoundException);
      expect(workItemRepo.create).not.toHaveBeenCalled();
    });
  });

  // ── Tasks list / totals ──────────────────────────────────────────────────

  describe('listTasks', () => {
    it('cannot list tasks of a foreign tenant parent', async () => {
      await expect(service.listTasks(TENANT_B, 'wi-a')).rejects.toThrow(NotFoundException);
      expect(workItemRepo.listTasksByParent).not.toHaveBeenCalled();
    });
  });

  describe('getTaskTotals', () => {
    it('cannot read task totals of a foreign tenant parent', async () => {
      await expect(service.getTaskTotals(TENANT_B, 'wi-a')).rejects.toThrow(NotFoundException);
      expect(workItemRepo.getTaskTotals).not.toHaveBeenCalled();
    });
  });

  // ── Activity ──────────────────────────────────────────────────────────────

  describe('getActivity', () => {
    it('cannot read activity of a foreign tenant work item', async () => {
      await expect(
        service.getActivity(TENANT_B, 'wi-a', { limit: 10, offset: 0 }),
      ).rejects.toThrow(NotFoundException);
      expect(activityRepo.listByWorkItem).not.toHaveBeenCalled();
    });
  });

  // ── Labels ────────────────────────────────────────────────────────────────

  describe('label management', () => {
    it('cannot list labels of a foreign tenant work item', async () => {
      await expect(service.getWorkItemLabels(TENANT_B, 'wi-a')).rejects.toThrow(NotFoundException);
      expect(workItemRepo.listLabels).not.toHaveBeenCalled();
    });

    it('cannot add a label to a foreign tenant work item', async () => {
      await expect(service.addLabelToWorkItem(TENANT_B, 'wi-a', 'l1')).rejects.toThrow(
        NotFoundException,
      );
      expect(workItemRepo.addLabel).not.toHaveBeenCalled();
    });

    it('adds a label using the caller tenantId', async () => {
      await service.addLabelToWorkItem(TENANT_A, 'wi-a', 'l1');
      expect(workItemRepo.addLabel).toHaveBeenCalledWith('wi-a', 'l1', TENANT_A);
    });

    it('cannot remove a label from a foreign tenant work item', async () => {
      await expect(service.removeLabelFromWorkItem(TENANT_B, 'wi-a', 'l1')).rejects.toThrow(
        NotFoundException,
      );
      expect(workItemRepo.removeLabel).not.toHaveBeenCalled();
    });
  });

  // ── reorderWorkItems / rankWorkItem ──────────────────────────────────────

  describe('reorderWorkItems', () => {
    it('cannot reorder a foreign tenant work item', async () => {
      await expect(
        service.reorderWorkItems(TENANT_B, [{ id: 'wi-a', rank: 'b1' }]),
      ).rejects.toThrow(NotFoundException);
      expect(workItemRepo.reorderItems).not.toHaveBeenCalled();
    });
  });

  describe('rankWorkItem', () => {
    it('cannot rank a foreign tenant work item', async () => {
      await expect(
        service.rankWorkItem(actorForTenant(TENANT_B), 'wi-a', {
          projectId: 'proj-1',
          beforeId: null,
          afterId: null,
        }),
      ).rejects.toThrow(NotFoundException);
      expect(workItemRepo.update).not.toHaveBeenCalled();
    });

    it('neighbour lookup uses the caller tenantId', async () => {
      workItemRepo.findByIds.mockResolvedValueOnce([mockWorkItem({ id: 'before', rank: 'a' })]);
      await service.rankWorkItem(actorForTenant(TENANT_A), 'wi-a', {
        projectId: 'proj-1',
        beforeId: 'before',
        afterId: null,
      });
      expect(workItemRepo.findByIds).toHaveBeenCalledWith(['before'], TENANT_A);
    });
  });

  // ── Bulk assignment ───────────────────────────────────────────────────────

  describe('bulk assignment', () => {
    it('bulkAssignRelease loads items scoped to the caller tenantId', async () => {
      await expect(
        service.bulkAssignRelease(actorForTenant(TENANT_B), 'proj-1', ['wi-a'], null),
      ).rejects.toThrow(NotFoundException);
      expect(workItemRepo.findByIds).toHaveBeenCalledWith(['wi-a'], TENANT_B);
      expect(workItemRepo.assignRelease).not.toHaveBeenCalled();
    });

    it('bulkAssignIteration loads items scoped to the caller tenantId', async () => {
      await expect(
        service.bulkAssignIteration(actorForTenant(TENANT_B), 'proj-1', ['wi-a'], null),
      ).rejects.toThrow(NotFoundException);
      expect(workItemRepo.findByIds).toHaveBeenCalledWith(['wi-a'], TENANT_B);
      expect(workItemRepo.assignIteration).not.toHaveBeenCalled();
    });
  });

  // ── Time logging ──────────────────────────────────────────────────────────

  describe('time logs', () => {
    it('cannot list time logs of a foreign tenant work item', async () => {
      await expect(
        service.listTimeLogs(TENANT_B, 'wi-a', { page: 1, pageSize: 20 }),
      ).rejects.toThrow(NotFoundException);
      expect(timeLogRepo.listByWorkItem).not.toHaveBeenCalled();
    });

    it('cannot log time against a foreign tenant work item', async () => {
      await expect(
        service.logTime(actorForTenant(TENANT_B), 'wi-a', { loggedDate: '2026-06-25', hours: '1' }),
      ).rejects.toThrow(NotFoundException);
      expect(timeLogRepo.create).not.toHaveBeenCalled();
    });

    it('logs time using the caller tenantId', async () => {
      await service.logTime(actorForTenant(TENANT_A), 'wi-a', {
        loggedDate: '2026-06-25',
        hours: '1',
      });
      expect(timeLogRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: TENANT_A, workItemId: 'wi-a' }),
      );
    });

    it('cannot update a time log via a foreign tenant work item scope', async () => {
      await expect(
        service.updateTimeLog(actorForTenant(TENANT_B), 'wi-a', 'log-a', { hours: '3' }),
      ).rejects.toThrow(NotFoundException);
      expect(timeLogRepo.update).not.toHaveBeenCalled();
    });

    it('cannot delete a time log via a foreign tenant work item scope', async () => {
      await expect(
        service.deleteTimeLog(actorForTenant(TENANT_B), 'wi-a', 'log-a'),
      ).rejects.toThrow(NotFoundException);
      expect(timeLogRepo.softDelete).not.toHaveBeenCalled();
    });
  });

  // ── Watchers ──────────────────────────────────────────────────────────────

  describe('watchers', () => {
    it('cannot list watchers of a foreign tenant work item', async () => {
      await expect(service.listWatchers(TENANT_B, 'wi-a')).rejects.toThrow(NotFoundException);
      expect(watcherRepo.listByWorkItem).not.toHaveBeenCalled();
    });

    it('cannot watch a foreign tenant work item', async () => {
      await expect(service.watch(actorForTenant(TENANT_B), 'wi-a')).rejects.toThrow(
        NotFoundException,
      );
      expect(watcherRepo.watch).not.toHaveBeenCalled();
    });

    it('watches using the caller tenantId', async () => {
      await service.watch(actorForTenant(TENANT_A), 'wi-a');
      expect(watcherRepo.watch).toHaveBeenCalledWith('wi-a', 'user-1', TENANT_A);
    });

    it('cannot unwatch a foreign tenant work item', async () => {
      await expect(service.unwatch(actorForTenant(TENANT_B), 'wi-a')).rejects.toThrow(
        NotFoundException,
      );
      expect(watcherRepo.unwatch).not.toHaveBeenCalled();
    });
  });

  // ── Attachments ───────────────────────────────────────────────────────────

  describe('attachments', () => {
    it('cannot presign an attachment against a foreign tenant work item', async () => {
      await expect(
        service.presignAttachment(actorForTenant(TENANT_B), 'wi-a', {
          filename: 'a.txt',
          mimeType: 'text/plain',
          sizeBytes: 10,
        }),
      ).rejects.toThrow(NotFoundException);
      expect(attachmentRepo.create).not.toHaveBeenCalled();
    });

    it('presigns using the caller tenantId', async () => {
      await service.presignAttachment(actorForTenant(TENANT_A), 'wi-a', {
        filename: 'a.txt',
        mimeType: 'text/plain',
        sizeBytes: 10,
      });
      expect(attachmentRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: TENANT_A, workItemId: 'wi-a' }),
      );
    });

    it('cannot confirm an attachment via a foreign tenant work item scope', async () => {
      await expect(
        service.confirmAttachment(actorForTenant(TENANT_B), 'wi-a', 'att-a'),
      ).rejects.toThrow(NotFoundException);
      expect(attachmentRepo.confirm).not.toHaveBeenCalled();
    });

    it('cannot list attachments of a foreign tenant work item', async () => {
      await expect(service.listAttachments(TENANT_B, 'wi-a')).rejects.toThrow(NotFoundException);
      expect(attachmentRepo.listByWorkItem).not.toHaveBeenCalled();
    });

    it('cannot get a download url via a foreign tenant work item scope', async () => {
      await expect(
        service.getAttachmentDownloadUrl(TENANT_B, 'wi-a', 'att-a'),
      ).rejects.toThrow(NotFoundException);
      expect(attachmentRepo.findById).not.toHaveBeenCalled();
    });

    it('cannot delete an attachment via a foreign tenant work item scope', async () => {
      await expect(
        service.deleteAttachment(actorForTenant(TENANT_B), 'wi-a', 'att-a'),
      ).rejects.toThrow(NotFoundException);
      expect(attachmentRepo.softDelete).not.toHaveBeenCalled();
    });
  });

  // ── List endpoints (project-scoped, not item-scoped) ─────────────────────

  describe('listWorkItems / listBacklog', () => {
    it('listWorkItems resolves project access using the caller tenantId', async () => {
      workItemRepo.listByProject.mockResolvedValue({
        data: [],
        pageInfo: { nextCursor: null, hasNextPage: false, limit: 20 },
      });
      await service.listWorkItems(actorForTenant(TENANT_B), 'proj-1', {}, { limit: 20, cursor: null });
      expect(projectsService.getProject).toHaveBeenCalledWith(TENANT_B, 'proj-1');
      expect(workItemRepo.listByProject).toHaveBeenCalledWith(
        'proj-1',
        TENANT_B,
        {},
        expect.anything(),
      );
    });

    it('listBacklog resolves project access using the caller tenantId', async () => {
      workItemRepo.listBacklog.mockResolvedValue({
        data: [],
        pageInfo: { nextCursor: null, hasNextPage: false, limit: 20 },
      });
      await service.listBacklog(actorForTenant(TENANT_B), 'proj-1', {}, { limit: 20, cursor: null });
      expect(projectsService.getProject).toHaveBeenCalledWith(TENANT_B, 'proj-1');
      expect(workItemRepo.listBacklog).toHaveBeenCalledWith(
        'proj-1',
        TENANT_B,
        {},
        expect.anything(),
      );
    });
  });
});
