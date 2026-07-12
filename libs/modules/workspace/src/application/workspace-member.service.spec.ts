import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mocked } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { WorkspaceMemberService } from './workspace-member.service';
import { WORKSPACE_REPOSITORY, IWorkspaceRepository } from '../domain/ports/workspace.repository';
import {
  WORKSPACE_MEMBER_REPOSITORY,
  IWorkspaceMemberRepository,
} from '../domain/ports/workspace-member.repository';
import type { Workspace, WorkspaceMember } from '../domain/tenancy.types';
import { NotFoundException, ConflictException, TenantRlsService } from '@platform';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const now = new Date('2024-06-01');

const mockWorkspace = (o: Partial<Workspace> = {}): Workspace => ({
  id: 'ws-1',
  tenantId: 'tenant-1',
  slug: 'main',
  name: 'Main',
  description: null,
  avatarUrl: null,
  settings: {},
  createdAt: now,
  updatedAt: now,
  deletedAt: null,
  ...o,
});

const mockMember = (o: Partial<WorkspaceMember> = {}): WorkspaceMember => ({
  id: 'member-1',
  tenantId: 'tenant-1',
  workspaceId: 'ws-1',
  userId: 'user-1',
  roleId: null,
  status: 'active',
  joinedAt: now,
  updatedAt: now,
  createdAt: now,
  ...o,
});

// ── Mock factories ────────────────────────────────────────────────────────────

const makeWorkspaceRepo = (): Mocked<IWorkspaceRepository> =>
  ({
    findById: vi.fn(),
    findBySlug: vi.fn(),
    listByTenant: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    softDelete: vi.fn().mockResolvedValue(undefined),
  });

const makeMemberRepo = (): Mocked<IWorkspaceMemberRepository> =>
  ({
    findMember: vi.fn(),
    findMemberById: vi.fn(),
    listMembers: vi.fn(),
    listMembersWithProfile: vi.fn(),
    addMember: vi.fn(),
    updateMember: vi.fn(),
    removeMember: vi.fn().mockResolvedValue(undefined),
    isMember: vi.fn().mockResolvedValue(false),
    countActiveAdmins: vi.fn().mockResolvedValue(0),
  });

const makeRls = () => ({
  withTenantContext: vi.fn((_tenantId: string, fn: (tx: unknown) => unknown) => fn({})),
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('WorkspaceMemberService', () => {
  let service: WorkspaceMemberService;
  let workspaceRepo: ReturnType<typeof makeWorkspaceRepo>;
  let memberRepo: ReturnType<typeof makeMemberRepo>;
  let rls: ReturnType<typeof makeRls>;

  beforeEach(async () => {
    workspaceRepo = makeWorkspaceRepo();
    memberRepo = makeMemberRepo();
    rls = makeRls();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkspaceMemberService,
        { provide: WORKSPACE_REPOSITORY, useValue: workspaceRepo },
        { provide: WORKSPACE_MEMBER_REPOSITORY, useValue: memberRepo },
        { provide: TenantRlsService, useValue: rls },
      ],
    }).compile();

    service = module.get(WorkspaceMemberService);
  });

  // ── addMember ──────────────────────────────────────────────────────────────

  describe('addMember', () => {
    it('adds member when not already a member', async () => {
      workspaceRepo.findById.mockResolvedValue(mockWorkspace());
      memberRepo.findMember.mockResolvedValue(null);
      memberRepo.addMember.mockResolvedValue(mockMember());

      const result = await service.addMember('tenant-1', 'ws-1', 'user-2', 'actor-1');
      expect(result.userId).toBe('user-1');
    });

    it('throws ConflictException if user is already a member', async () => {
      workspaceRepo.findById.mockResolvedValue(mockWorkspace());
      memberRepo.findMember.mockResolvedValue(mockMember());

      await expect(service.addMember('tenant-1', 'ws-1', 'user-1', 'actor-1')).rejects.toThrow(
        ConflictException,
      );
    });
  });

  // ── removeMember ──────────────────────────────────────────────────────────

  describe('removeMember', () => {
    it('removes member', async () => {
      workspaceRepo.findById.mockResolvedValue(mockWorkspace());
      memberRepo.findMember.mockResolvedValue(mockMember());

      await service.removeMember('tenant-1', 'ws-1', 'user-1', 'actor-1');
      expect(memberRepo.removeMember).toHaveBeenCalledWith(
        'ws-1',
        'user-1',
        expect.anything(),
      );
    });

    it('throws NotFoundException if user is not a member', async () => {
      workspaceRepo.findById.mockResolvedValue(mockWorkspace());
      memberRepo.findMember.mockResolvedValue(null);

      await expect(service.removeMember('tenant-1', 'ws-1', 'user-99', 'actor-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
