import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mocked } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { WorkspaceMemberService } from './workspace-member.service';
import { WORKSPACE_REPOSITORY, IWorkspaceRepository } from '../domain/ports/workspace.repository';
import {
  WORKSPACE_MEMBER_REPOSITORY,
  IWorkspaceMemberRepository,
} from '../domain/ports/workspace-member.repository';
import type { Workspace, WorkspaceMember } from '../domain/workspace.types';
import { NotFoundException, ConflictException } from '@platform';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const now = new Date('2024-06-01');

const mockWorkspace = (o: Partial<Workspace> = {}): Workspace => ({
  id: 'ws-1',
  slug: 'main',
  name: 'Main',
  description: null,
  avatarUrl: null,
  status: 'active',
  settings: {},
  createdAt: now,
  updatedAt: now,
  deletedAt: null,
  ...o,
});

const mockMember = (o: Partial<WorkspaceMember> = {}): WorkspaceMember => ({
  id: 'member-1',
  workspaceId: 'ws-1',
  userId: 'user-1',
  roleId: null,
  status: 'active',
  lastActiveAt: null,
  joinedAt: now,
  updatedAt: now,
  createdAt: now,
  ...o,
});

// ── Mock factories ────────────────────────────────────────────────────────────

const makeWorkspaceRepo = (): Mocked<IWorkspaceRepository> => ({
  findById: vi.fn(),
  findBySlug: vi.fn(),
  listForUser: vi.fn(),
  listAll: vi.fn(),
  count: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  softDelete: vi.fn().mockResolvedValue(undefined),
});

const makeMemberRepo = (): Mocked<IWorkspaceMemberRepository> => ({
  findMember: vi.fn(),
  findMemberById: vi.fn(),
  findMembershipsForUser: vi.fn(),
  listMembers: vi.fn(),
  listMembersWithProfile: vi.fn(),
  addMember: vi.fn(),
  updateMember: vi.fn(),
  removeMember: vi.fn().mockResolvedValue(undefined),
  isMember: vi.fn().mockResolvedValue(false),
  touchLastActive: vi.fn().mockResolvedValue(undefined),
  countActiveAdmins: vi.fn().mockResolvedValue(0),
  isActiveAdmin: vi.fn().mockResolvedValue(false),
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('WorkspaceMemberService', () => {
  let service: WorkspaceMemberService;
  let workspaceRepo: ReturnType<typeof makeWorkspaceRepo>;
  let memberRepo: ReturnType<typeof makeMemberRepo>;

  beforeEach(async () => {
    workspaceRepo = makeWorkspaceRepo();
    memberRepo = makeMemberRepo();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkspaceMemberService,
        { provide: WORKSPACE_REPOSITORY, useValue: workspaceRepo },
        { provide: WORKSPACE_MEMBER_REPOSITORY, useValue: memberRepo },
      ],
    }).compile();

    service = module.get(WorkspaceMemberService);
  });

  // ── addMember ──────────────────────────────────────────────────────────────

  describe('addMember', () => {
    it('adds member when not already a member', async () => {
      workspaceRepo.findById.mockResolvedValue(mockWorkspace());
      memberRepo.findMember.mockResolvedValue(null);
      memberRepo.addMember.mockResolvedValue(mockMember({ userId: 'user-2' }));

      const result = await service.addMember('ws-1', 'user-2', 'actor-1');
      expect(result.userId).toBe('user-2');
      expect(memberRepo.addMember).toHaveBeenCalledWith(
        expect.objectContaining({ workspaceId: 'ws-1', userId: 'user-2' }),
      );
    });

    it('throws ConflictException if user is already a member', async () => {
      workspaceRepo.findById.mockResolvedValue(mockWorkspace());
      memberRepo.findMember.mockResolvedValue(mockMember());

      await expect(service.addMember('ws-1', 'user-1', 'actor-1')).rejects.toThrow(
        ConflictException,
      );
    });

    it('throws NotFoundException if workspace does not exist', async () => {
      workspaceRepo.findById.mockResolvedValue(null);

      await expect(service.addMember('ws-x', 'user-1', 'actor-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ── removeMember ──────────────────────────────────────────────────────────

  describe('removeMember', () => {
    it('removes member', async () => {
      workspaceRepo.findById.mockResolvedValue(mockWorkspace());
      memberRepo.findMember.mockResolvedValue(mockMember());

      await service.removeMember('ws-1', 'user-1', 'actor-1');
      expect(memberRepo.removeMember).toHaveBeenCalledWith('ws-1', 'user-1');
    });

    it('throws NotFoundException if user is not a member', async () => {
      workspaceRepo.findById.mockResolvedValue(mockWorkspace());
      memberRepo.findMember.mockResolvedValue(null);

      await expect(service.removeMember('ws-1', 'user-99', 'actor-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
