import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mocked } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { InvitationService } from './invitation.service';
import { WORKSPACE_REPOSITORY, IWorkspaceRepository } from '../domain/ports/workspace.repository';
import {
  WORKSPACE_INVITATION_REPOSITORY,
  IWorkspaceInvitationRepository,
} from '../domain/ports/workspace-invitation.repository';
import {
  WORKSPACE_MEMBER_REPOSITORY,
  IWorkspaceMemberRepository,
} from '../domain/ports/workspace-member.repository';
import type { Workspace, WorkspaceInvitation } from '../domain/workspace.types';
import { NotFoundException, AppConfigService, EmailSchedulerService, UnitOfWork } from '@platform';

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

const mockInvitation = (o: Partial<WorkspaceInvitation> = {}): WorkspaceInvitation => ({
  id: 'inv-1',
  workspaceId: 'ws-1',
  email: 'bob@example.com',
  roleId: null,
  status: 'pending',
  invitedBy: 'user-1',
  expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
  acceptedBy: null,
  acceptedAt: null,
  createdAt: now,
  updatedAt: now,
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

const makeInvitationRepo = (): Mocked<IWorkspaceInvitationRepository> => ({
  findByTokenHash: vi.fn(),
  findById: vi.fn(),
  findPendingByEmail: vi.fn(),
  listByWorkspace: vi.fn(),
  create: vi.fn(),
  updateStatus: vi.fn().mockResolvedValue(undefined),
  cancelExistingForEmail: vi.fn().mockResolvedValue(undefined),
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

const makeConfig = () => ({
  get: vi.fn((key: string) => {
    const vals: Record<string, unknown> = {
      APP_BASE_URL: 'http://localhost:5173',
      INVITATION_TTL_DAYS: 7,
    };
    return vals[key];
  }),
});

const makeEmailScheduler = () => ({
  schedule: vi.fn().mockResolvedValue(undefined),
});

// Run the wrapped work immediately with a stub transaction so repository mocks
// receive a tx argument exactly as they would in production.
const makeUow = () => ({
  run: vi.fn((fn: (tx: unknown) => unknown) => fn({})),
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('InvitationService', () => {
  let service: InvitationService;
  let workspaceRepo: ReturnType<typeof makeWorkspaceRepo>;
  let invitationRepo: ReturnType<typeof makeInvitationRepo>;
  let memberRepo: ReturnType<typeof makeMemberRepo>;
  let emailScheduler: ReturnType<typeof makeEmailScheduler>;
  let uow: ReturnType<typeof makeUow>;

  beforeEach(async () => {
    workspaceRepo = makeWorkspaceRepo();
    invitationRepo = makeInvitationRepo();
    memberRepo = makeMemberRepo();
    emailScheduler = makeEmailScheduler();
    uow = makeUow();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InvitationService,
        { provide: WORKSPACE_REPOSITORY, useValue: workspaceRepo },
        { provide: WORKSPACE_INVITATION_REPOSITORY, useValue: invitationRepo },
        { provide: WORKSPACE_MEMBER_REPOSITORY, useValue: memberRepo },
        { provide: AppConfigService, useValue: makeConfig() },
        { provide: EmailSchedulerService, useValue: emailScheduler },
        { provide: UnitOfWork, useValue: uow },
      ],
    }).compile();

    service = module.get(InvitationService);
  });

  // ── inviteMember ───────────────────────────────────────────────────────────

  describe('inviteMember', () => {
    it('creates invitation and sends email', async () => {
      workspaceRepo.findById.mockResolvedValue(mockWorkspace());
      invitationRepo.create.mockResolvedValue(mockInvitation());

      const result = await service.inviteMember('ws-1', 'bob@example.com', undefined, 'actor-1');

      expect(result.email).toBe('bob@example.com');
      expect(invitationRepo.cancelExistingForEmail).toHaveBeenCalledWith(
        'ws-1',
        'bob@example.com',
        expect.anything(),
      );
      expect(invitationRepo.create).toHaveBeenCalledOnce();
      expect(emailScheduler.schedule).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'bob@example.com',
          template: 'workspace-invitation',
          vars: expect.objectContaining({
            workspaceName: 'Main',
            inviteUrl: expect.stringContaining('/accept-invitation?token='),
          }),
        }),
        expect.anything(),
      );
    });

    it('normalises email to lowercase before creating invitation', async () => {
      workspaceRepo.findById.mockResolvedValue(mockWorkspace());
      invitationRepo.create.mockResolvedValue(mockInvitation({ email: 'bob@example.com' }));

      await service.inviteMember('ws-1', 'BOB@Example.com', undefined, 'actor-1');

      expect(invitationRepo.cancelExistingForEmail).toHaveBeenCalledWith(
        'ws-1',
        'bob@example.com',
        expect.anything(),
      );
    });
  });

  // ── cancelInvitation ───────────────────────────────────────────────────────

  describe('cancelInvitation', () => {
    it('cancels pending invitation', async () => {
      workspaceRepo.findById.mockResolvedValue(mockWorkspace());
      invitationRepo.findById.mockResolvedValue(mockInvitation());

      await service.cancelInvitation('ws-1', 'inv-1', 'actor-1');

      expect(invitationRepo.updateStatus).toHaveBeenCalledWith('inv-1', 'cancelled');
    });

    it('throws NotFoundException when invitation not found', async () => {
      workspaceRepo.findById.mockResolvedValue(mockWorkspace());
      invitationRepo.findById.mockResolvedValue(null);

      await expect(service.cancelInvitation('ws-1', 'inv-missing', 'actor-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ── acceptInvitation ───────────────────────────────────────────────────────

  describe('acceptInvitation', () => {
    it('accepts pending invitation and adds member', async () => {
      invitationRepo.findByTokenHash.mockResolvedValue(mockInvitation({ status: 'pending' }));
      memberRepo.findMember.mockResolvedValue(null);
      memberRepo.addMember.mockResolvedValue({
        id: 'member-1',
        workspaceId: 'ws-1',
        userId: 'user-2',
        roleId: null,
        status: 'active',
        lastActiveAt: null,
        joinedAt: now,
        updatedAt: now,
        createdAt: now,
      });

      await service.acceptInvitation('raw-token', 'user-2');

      expect(invitationRepo.updateStatus).toHaveBeenCalledWith(
        'inv-1',
        'accepted',
        'user-2',
        expect.anything(),
      );
      expect(memberRepo.addMember).toHaveBeenCalledOnce();
    });

    it('throws NotFoundException when token not found', async () => {
      invitationRepo.findByTokenHash.mockResolvedValue(null);
      await expect(service.acceptInvitation('bad-token', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws when invitation already accepted', async () => {
      invitationRepo.findByTokenHash.mockResolvedValue(mockInvitation({ status: 'accepted' }));
      await expect(service.acceptInvitation('token', 'user-1')).rejects.toThrow();
    });

    it('throws when invitation expired', async () => {
      invitationRepo.findByTokenHash.mockResolvedValue(
        mockInvitation({ status: 'pending', expiresAt: new Date(Date.now() - 1000) }),
      );
      await expect(service.acceptInvitation('expired-token', 'user-1')).rejects.toThrow();
    });
  });
});
