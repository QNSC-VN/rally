import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { PreconditionFailedException } from '@platform';
import { WorkItemsService } from '@modules/work-items';
import { AccessService } from '@modules/access';
import { CollaborationService } from './collaboration.service';
import { COMMENT_REPOSITORY } from '../domain/ports/comment.repository';
import type { Comment } from '../domain/collaboration.types';

const now = new Date('2024-06-01');

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
  authMethod: 'sso' as const,
};

const mockComment = (o: Partial<Comment> = {}): Comment => ({
  id: 'c-1',
  workspaceId: 'ws-1',
  workItemId: 'wi-1',
  authorId: 'user-1',
  body: 'hello',
  parentId: null,
  isEdited: false,
  editedAt: null,
  deletedAt: null,
  createdAt: now,
  updatedAt: now,
  ...o,
});

const makeCommentRepo = () => ({
  findById: vi.fn(),
  listByWorkItem: vi.fn().mockResolvedValue([]),
  create: vi.fn().mockImplementation((input) => Promise.resolve(mockComment(input))),
  update: vi.fn().mockImplementation((id, body) => Promise.resolve(mockComment({ id, body }))),
  softDelete: vi.fn().mockResolvedValue(undefined),
});

// getWorkItem resolves the item so the service can read its projectId.
const makeWorkItemsService = () => ({
  getWorkItem: vi.fn().mockResolvedValue({ id: 'wi-1', projectId: 'proj-9', workspaceId: 'ws-1' }),
  notifyCommentAdded: vi.fn().mockResolvedValue(undefined),
});

const makeAccessService = () => ({
  assertProjectPermission: vi.fn().mockResolvedValue(undefined),
});

describe('CollaborationService — project-scoped comment writes', () => {
  let service: CollaborationService;
  let commentRepo: ReturnType<typeof makeCommentRepo>;
  let workItemsService: ReturnType<typeof makeWorkItemsService>;
  let accessService: ReturnType<typeof makeAccessService>;

  beforeEach(async () => {
    commentRepo = makeCommentRepo();
    workItemsService = makeWorkItemsService();
    accessService = makeAccessService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CollaborationService,
        { provide: COMMENT_REPOSITORY, useValue: commentRepo },
        { provide: WorkItemsService, useValue: workItemsService },
        { provide: AccessService, useValue: accessService },
      ],
    }).compile();

    service = module.get(CollaborationService);
  });

  describe('createComment', () => {
    it('authorizes work_item:edit against the item’s project before creating', async () => {
      await service.createComment(mockActor, 'wi-1', 'hi');
      expect(workItemsService.getWorkItem).toHaveBeenCalledWith('ws-1', 'wi-1');
      expect(accessService.assertProjectPermission).toHaveBeenCalledWith(
        mockActor,
        'proj-9',
        'work_item:edit',
      );
      expect(commentRepo.create).toHaveBeenCalledOnce();
    });

    it('does not create when authorization is denied', async () => {
      accessService.assertProjectPermission.mockRejectedValueOnce(new Error('DENIED'));
      await expect(service.createComment(mockActor, 'wi-1', 'hi')).rejects.toThrow('DENIED');
      expect(commentRepo.create).not.toHaveBeenCalled();
    });
  });

  describe('updateComment', () => {
    it('authorizes the project after the owner check', async () => {
      commentRepo.findById.mockResolvedValue(mockComment());
      await service.updateComment(mockActor, 'c-1', 'edited');
      expect(accessService.assertProjectPermission).toHaveBeenCalledWith(
        mockActor,
        'proj-9',
        'work_item:edit',
      );
      expect(commentRepo.update).toHaveBeenCalledWith('c-1', 'edited');
    });

    it('rejects editing another user’s comment before touching authorization', async () => {
      commentRepo.findById.mockResolvedValue(mockComment({ authorId: 'someone-else' }));
      await expect(service.updateComment(mockActor, 'c-1', 'edited')).rejects.toThrow(
        PreconditionFailedException,
      );
      expect(accessService.assertProjectPermission).not.toHaveBeenCalled();
    });
  });

  describe('deleteComment', () => {
    it('authorizes the project before soft-deleting', async () => {
      commentRepo.findById.mockResolvedValue(mockComment());
      await service.deleteComment(mockActor, 'c-1');
      expect(accessService.assertProjectPermission).toHaveBeenCalledWith(
        mockActor,
        'proj-9',
        'work_item:edit',
      );
      expect(commentRepo.softDelete).toHaveBeenCalledWith('c-1');
    });
  });
});
