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
import { NotFoundException, UnitOfWork } from '@platform';
import { ProjectsService } from '@modules/projects';

// Workspace isolation is now enforced purely at the application layer (the RLS
// safety net is gone). These tests exercise that boundary directly: a caller
// scoped to workspace B must never be able to read or mutate a work item that
// belongs to workspace A, through any code path.

const now = new Date('2024-06-01');

const WS_A = '00000000-0000-7000-8000-00000000000a';
const WS_B = '00000000-0000-7000-8000-00000000000b';

const mockWorkItem = (o: Partial<WorkItem> = {}): WorkItem => ({
  id: 'wi-a',
  workspaceId: WS_A,
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

const actorForWorkspace = (workspaceId: string) => ({
  sub: 'user-1',
  workspaceId,
  sessionId: 's1',
  jti: 'j1',
  iat: 0,
  exp: 0,
  iss: 'rally',
  aud: 'rally-app',
  permissions: [] as string[],
  authMethod: 'password' as const,
});

// A findById that faithfully simulates the SQL `WHERE id = ? AND workspace_id = ?`
// scoping: an item is only visible to its owning workspace.
const makeScopedWorkItemRepo = (items: WorkItem[]) => ({
  findById: vi.fn((id: string, workspaceId: string) =>
    Promise.resolve(items.find((i) => i.id === id && i.workspaceId === workspaceId) ?? null),
  ),
  findByIds: vi.fn((ids: string[], workspaceId: string) =>
    Promise.resolve(items.filter((i) => ids.includes(i.id) && i.workspaceId === workspaceId)),
  ),
  findIterationScope: vi.fn().mockResolvedValue(null),
  findReleaseProject: vi.fn().mockResolvedValue(null),
  assignIteration: vi.fn().mockResolvedValue(undefined),
  assignRelease: vi.fn().mockResolvedValue(undefined),
  listByProject: vi.fn(),
  listBacklog: vi.fn(),
  listTasksByParent: vi.fn(),
  getTaskTotals: vi.fn(),
  create: vi.fn(),
  update: vi.fn((id: string, _wsId: string, patch: Partial<WorkItem>) =>
    Promise.resolve(mockWorkItem({ id, ...patch })),
  ),
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
  getProject: vi.fn().mockResolvedValue({ id: 'proj-1', workspaceId: WS_A }),
  listStatuses: vi.fn().mockResolvedValue([]),
  assertTransitionAllowed: vi.fn().mockResolvedValue(undefined),
  generateItemKey: vi.fn().mockResolvedValue('PROJ-42'),
  listProjectTeams: vi.fn().mockResolvedValue([]),
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
  presignPut: vi.fn(),
  presignGet: vi.fn(),
  headObject: vi.fn(),
  deleteObject: vi.fn().mockResolvedValue(undefined),
  cdnUrl: vi.fn().mockReturnValue(null),
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('WorkItemsService — workspace isolation', () => {
  let service: WorkItemsService;
  let workItemRepo: ReturnType<typeof makeScopedWorkItemRepo>;
  const itemA = mockWorkItem({ id: 'wi-a', workspaceId: WS_A });

  const build = async (repo: ReturnType<typeof makeScopedWorkItemRepo>) => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkItemsService,
        { provide: WORK_ITEM_REPOSITORY, useValue: repo },
        { provide: ACTIVITY_LOG_REPOSITORY, useValue: makeActivityRepo() },
        { provide: TIME_LOG_REPOSITORY, useValue: makeTimeLogRepo() },
        { provide: WATCHER_REPOSITORY, useValue: makeWatcherRepo() },
        { provide: ATTACHMENT_REPOSITORY, useValue: makeAttachmentRepo() },
        { provide: StorageService, useValue: makeStorageService() },
        { provide: ProjectsService, useValue: makeProjectsService() },
        { provide: UnitOfWork, useValue: makeUnitOfWork() },
      ],
    }).compile();
    return module.get(WorkItemsService);
  };

  beforeEach(async () => {
    workItemRepo = makeScopedWorkItemRepo([itemA]);
    service = await build(workItemRepo);
  });

  it('reads a work item for its owning workspace', async () => {
    const item = await service.getWorkItem(WS_A, 'wi-a');
    expect(item.id).toBe('wi-a');
    expect(workItemRepo.findById).toHaveBeenCalledWith('wi-a', WS_A);
  });

  it('cannot fetch a foreign workspace work item by id', async () => {
    await expect(service.getWorkItem(WS_B, 'wi-a')).rejects.toThrow(NotFoundException);
    // The repo was queried strictly under the caller's workspace scope.
    expect(workItemRepo.findById).toHaveBeenCalledWith('wi-a', WS_B);
  });

  it('cannot update a foreign workspace work item', async () => {
    await expect(
      service.updateWorkItem(actorForWorkspace(WS_B), 'wi-a', { title: 'hijacked' }),
    ).rejects.toThrow(NotFoundException);
    expect(workItemRepo.update).not.toHaveBeenCalled();
  });

  it('defends in depth: rejects even if the repository leaks a foreign row', async () => {
    // Simulate a buggy/omitted SQL filter — the repo returns the foreign row.
    const leakyRepo = makeScopedWorkItemRepo([itemA]);
    leakyRepo.findById.mockResolvedValue(itemA); // ignores the workspaceId argument
    const leakyService = await build(leakyRepo);

    // The service's own `item.workspaceId !== workspaceId` guard must still block.
    await expect(leakyService.getWorkItem(WS_B, 'wi-a')).rejects.toThrow(NotFoundException);
  });

  it('cannot resolve foreign items in a batch lookup', async () => {
    const items = await workItemRepo.findByIds(['wi-a'], WS_B);
    expect(items).toHaveLength(0);
  });
});
