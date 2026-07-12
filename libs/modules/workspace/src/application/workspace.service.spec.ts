import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mocked } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { WorkspaceService } from './workspace.service';
import { WORKSPACE_REPOSITORY, IWorkspaceRepository } from '../domain/ports/workspace.repository';
import {
  WORKSPACE_MEMBER_REPOSITORY,
  IWorkspaceMemberRepository,
} from '../domain/ports/workspace-member.repository';
import {
<<<<<<<< HEAD:libs/modules/workspace/src/application/workspace.service.spec.ts
  WORKSPACE_INVITATION_REPOSITORY,
  IWorkspaceInvitationRepository,
} from '../domain/ports/workspace-invitation.repository';
import {
  WORKSPACE_SETTINGS_REPOSITORY,
  IWorkspaceSettingsRepository,
} from '../domain/ports/workspace-settings.repository';
import type { Workspace, WorkspaceMember, WorkspaceInvitation } from '../domain/workspace.types';
import {
  NotFoundException,
  ConflictException,
  PreconditionFailedException,
  AppConfigService,
  EmailSchedulerService,
  UnitOfWork,
} from '@platform';
========
  TENANT_DOMAIN_REPOSITORY,
  ITenantDomainRepository,
} from '../domain/ports/tenant-domain.repository';
import {
  TENANT_MEMBER_REPOSITORY,
  ITenantMemberRepository,
} from '../domain/ports/tenant-member.repository';
import type { Tenant } from '../domain/tenancy.types';
import { NotFoundException, AppConfigService, TenantRlsService } from '@platform';
>>>>>>>> 9af2412 (feat: Phase 3 — tasks table, defect lifecycle, milestones, UI polish & bug fixes):libs/modules/tenancy/src/application/tenancy.service.spec.ts

// ── Fixtures ─────────────────────────────────────────────────────────────────

const now = new Date('2024-06-01');

<<<<<<<< HEAD:libs/modules/workspace/src/application/workspace.service.spec.ts
const mockWorkspace = (o: Partial<Workspace> = {}): Workspace => ({
  id: 'ws-1',
  slug: 'main',
  name: 'Main',
  description: null,
  avatarUrl: null,
  status: 'active',
========
const mockTenant = (o: Partial<Tenant> = {}): Tenant => ({
  id: 'tenant-1',
  slug: 'acme',
  name: 'Acme Corp',
  status: 'active',
  plan: 'free',
>>>>>>>> 9af2412 (feat: Phase 3 — tasks table, defect lifecycle, milestones, UI polish & bug fixes):libs/modules/tenancy/src/application/tenancy.service.spec.ts
  settings: {},
  createdAt: now,
  updatedAt: now,
  deletedAt: null,
  ...o,
});

<<<<<<<< HEAD:libs/modules/workspace/src/application/workspace.service.spec.ts
const mockMember = (o: Partial<WorkspaceMember> = {}): WorkspaceMember => ({
  id: 'member-1',
  workspaceId: 'ws-1',
  userId: 'user-1',
  roleId: null,
  status: 'active',
  lastActiveAt: now,
  joinedAt: now,
  updatedAt: now,
  createdAt: now,
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

========
>>>>>>>> 9af2412 (feat: Phase 3 — tasks table, defect lifecycle, milestones, UI polish & bug fixes):libs/modules/tenancy/src/application/tenancy.service.spec.ts
// ── Mock factories ────────────────────────────────────────────────────────────

const makeWorkspaceRepo = (): Mocked<IWorkspaceRepository> => ({
  findById: vi.fn(),
  findBySlug: vi.fn(),
  listForUser: vi.fn(),
  listAll: vi.fn().mockResolvedValue([]),
  count: vi.fn().mockResolvedValue(0),
  create: vi.fn(),
  update: vi.fn(),
  softDelete: vi.fn().mockResolvedValue(undefined),
});

const makeMemberRepo = (): Mocked<IWorkspaceMemberRepository> => ({
  findMember: vi.fn(),
  findMemberById: vi.fn(),
  findMembershipsForUser: vi.fn().mockResolvedValue([]),
  listMembers: vi.fn(),
  listMembersWithProfile: vi.fn().mockResolvedValue([]),
  addMember: vi.fn(),
  updateMember: vi.fn(),
  removeMember: vi.fn().mockResolvedValue(undefined),
  isMember: vi.fn().mockResolvedValue(false),
  touchLastActive: vi.fn().mockResolvedValue(undefined),
  countActiveAdmins: vi.fn().mockResolvedValue(2),
  isActiveAdmin: vi.fn().mockResolvedValue(false),
});

const makeInvitationRepo = (): Mocked<IWorkspaceInvitationRepository> => ({
  findByTokenHash: vi.fn(),
  findById: vi.fn(),
  findPendingByEmail: vi.fn(),
  listByWorkspace: vi.fn().mockResolvedValue([]),
  create: vi.fn(),
  updateStatus: vi.fn().mockResolvedValue(undefined),
  cancelExistingForEmail: vi.fn().mockResolvedValue(undefined),
});

<<<<<<<< HEAD:libs/modules/workspace/src/application/workspace.service.spec.ts
const makeSettingsRepo = (): Mocked<IWorkspaceSettingsRepository> => ({
  findByWorkspace: vi.fn(),
  upsert: vi.fn(),
========
const makeTenantDomainRepo = (): Mocked<ITenantDomainRepository> => ({
  findByDomain: vi.fn().mockResolvedValue(null),
  create: vi
    .fn()
    .mockResolvedValue({ id: 'domain-1', domain: 'example.com', tenantId: 'tenant-1' }),
});

const makeTenantMemberRepo = (): Mocked<ITenantMemberRepository> => ({
  findByUserId: vi.fn().mockResolvedValue([]),
  findByUserAndTenant: vi.fn().mockResolvedValue(null),
  create: vi.fn().mockResolvedValue(undefined),
  touchLastActive: vi.fn().mockResolvedValue(undefined),
>>>>>>>> 9af2412 (feat: Phase 3 — tasks table, defect lifecycle, milestones, UI polish & bug fixes):libs/modules/tenancy/src/application/tenancy.service.spec.ts
});

const makeConfig = () => ({
  get: vi.fn((key: string) => {
    const vals: Record<string, unknown> = {
      APP_BASE_URL: 'http://localhost:5173',
      INVITATION_TTL_DAYS: 7,
    };
    return vals[key];
  }),
<<<<<<<< HEAD:libs/modules/workspace/src/application/workspace.service.spec.ts
});

const makeEmailScheduler = () => ({
  schedule: vi.fn().mockResolvedValue(undefined),
});

// Run the wrapped work immediately with a stub transaction so repository mocks
// receive a tx argument exactly as they would in production.
const makeUow = () => ({
  run: vi.fn((fn: (tx: unknown) => unknown) => fn({})),
========
  isSingleTenant: vi.fn().mockReturnValue(false),
});

const makeRls = () => ({
  withTenantContext: vi.fn((_tenantId: string, fn: (tx: unknown) => unknown) => fn({})),
>>>>>>>> 9af2412 (feat: Phase 3 — tasks table, defect lifecycle, milestones, UI polish & bug fixes):libs/modules/tenancy/src/application/tenancy.service.spec.ts
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('WorkspaceService', () => {
  let service: WorkspaceService;
  let workspaceRepo: ReturnType<typeof makeWorkspaceRepo>;
  let memberRepo: ReturnType<typeof makeMemberRepo>;
<<<<<<<< HEAD:libs/modules/workspace/src/application/workspace.service.spec.ts
  let invitationRepo: ReturnType<typeof makeInvitationRepo>;
  let settingsRepo: ReturnType<typeof makeSettingsRepo>;
  let emailScheduler: ReturnType<typeof makeEmailScheduler>;
========
  let tenantDomainRepo: ReturnType<typeof makeTenantDomainRepo>;
  let tenantMemberRepo: ReturnType<typeof makeTenantMemberRepo>;
  let rls: ReturnType<typeof makeRls>;
>>>>>>>> 9af2412 (feat: Phase 3 — tasks table, defect lifecycle, milestones, UI polish & bug fixes):libs/modules/tenancy/src/application/tenancy.service.spec.ts

  beforeEach(async () => {
    workspaceRepo = makeWorkspaceRepo();
    memberRepo = makeMemberRepo();
<<<<<<<< HEAD:libs/modules/workspace/src/application/workspace.service.spec.ts
    invitationRepo = makeInvitationRepo();
    settingsRepo = makeSettingsRepo();
    emailScheduler = makeEmailScheduler();
========
    tenantDomainRepo = makeTenantDomainRepo();
    tenantMemberRepo = makeTenantMemberRepo();
    rls = makeRls();
>>>>>>>> 9af2412 (feat: Phase 3 — tasks table, defect lifecycle, milestones, UI polish & bug fixes):libs/modules/tenancy/src/application/tenancy.service.spec.ts

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkspaceService,
        { provide: WORKSPACE_REPOSITORY, useValue: workspaceRepo },
        { provide: WORKSPACE_MEMBER_REPOSITORY, useValue: memberRepo },
<<<<<<<< HEAD:libs/modules/workspace/src/application/workspace.service.spec.ts
        { provide: WORKSPACE_INVITATION_REPOSITORY, useValue: invitationRepo },
        { provide: WORKSPACE_SETTINGS_REPOSITORY, useValue: settingsRepo },
        { provide: AppConfigService, useValue: makeConfig() },
        { provide: EmailSchedulerService, useValue: emailScheduler },
        { provide: UnitOfWork, useValue: makeUow() },
========
        { provide: TENANT_DOMAIN_REPOSITORY, useValue: tenantDomainRepo },
        { provide: TENANT_MEMBER_REPOSITORY, useValue: tenantMemberRepo },
        { provide: AppConfigService, useValue: makeConfig() },
        { provide: TenantRlsService, useValue: rls },
>>>>>>>> 9af2412 (feat: Phase 3 — tasks table, defect lifecycle, milestones, UI polish & bug fixes):libs/modules/tenancy/src/application/tenancy.service.spec.ts
      ],
    }).compile();

    service = module.get(WorkspaceService);
  });

  // ── ensureDefaultWorkspace ───────────────────────────────────────────────────

  describe('ensureDefaultWorkspace', () => {
    it('creates a default workspace when none exist', async () => {
      workspaceRepo.count.mockResolvedValue(0);
      workspaceRepo.create.mockResolvedValue(mockWorkspace({ slug: 'default' }));

      const result = await service.ensureDefaultWorkspace();

      expect(result?.slug).toBe('default');
      expect(workspaceRepo.create).toHaveBeenCalledOnce();
    });

    it('does nothing when a workspace already exists (idempotent)', async () => {
      workspaceRepo.count.mockResolvedValue(1);

      const result = await service.ensureDefaultWorkspace();

      expect(result).toBeNull();
      expect(workspaceRepo.create).not.toHaveBeenCalled();
    });
  });
<<<<<<<< HEAD:libs/modules/workspace/src/application/workspace.service.spec.ts

  // ── getMembership / touch / enroll ───────────────────────────────────────────

  describe('membership helpers', () => {
    it('getMemberships delegates to the member repo', async () => {
      memberRepo.findMembershipsForUser.mockResolvedValue([]);
      await service.getMemberships('user-1');
      expect(memberRepo.findMembershipsForUser).toHaveBeenCalledWith('user-1');
    });

    it('enrollMember adds a member when not already enrolled', async () => {
      memberRepo.findMember.mockResolvedValue(null);
      await service.enrollMember('ws-1', 'user-2');
      expect(memberRepo.addMember).toHaveBeenCalledOnce();
    });

    it('enrollMember is a no-op when already a member', async () => {
      memberRepo.findMember.mockResolvedValue(mockMember());
      await service.enrollMember('ws-1', 'user-1');
      expect(memberRepo.addMember).not.toHaveBeenCalled();
    });
  });

  // ── provisionWorkspace ───────────────────────────────────────────────────────

  describe('provisionWorkspace', () => {
    it('creates a workspace and enrolls the creator', async () => {
      workspaceRepo.create.mockResolvedValue(mockWorkspace());
      memberRepo.addMember.mockResolvedValue(mockMember());

      const result = await service.provisionWorkspace('Acme', 'user-1');

      expect(result.id).toBe('ws-1');
      expect(workspaceRepo.create).toHaveBeenCalledOnce();
      expect(memberRepo.addMember).toHaveBeenCalledOnce();
    });
  });

  // ── getWorkspace ─────────────────────────────────────────────────────────────

  describe('getWorkspace', () => {
    it('returns the workspace when found', async () => {
      workspaceRepo.findById.mockResolvedValue(mockWorkspace());
      const result = await service.getWorkspace('ws-1');
      expect(result.name).toBe('Main');
    });

    it('throws NotFoundException when not found', async () => {
      workspaceRepo.findById.mockResolvedValue(null);
      await expect(service.getWorkspace('missing')).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when soft-deleted', async () => {
      workspaceRepo.findById.mockResolvedValue(mockWorkspace({ deletedAt: now }));
      await expect(service.getWorkspace('ws-1')).rejects.toThrow(NotFoundException);
    });
  });

  // ── createWorkspace ──────────────────────────────────────────────────────────

  describe('createWorkspace', () => {
    const actor = {
      sub: 'user-1',
      workspaceId: 'ws-1',
      contextId: 'ws-1',
      sessionId: 's1',
      jti: 'j1',
      iat: 0,
      exp: 0,
      iss: '',
      aud: '',
      permissions: [] as string[],
      claims: { permissions: [] as string[] },
      authMethod: 'password' as const,
    };

    it('creates workspace when slug is available', async () => {
      workspaceRepo.findBySlug.mockResolvedValue(null);
      workspaceRepo.create.mockResolvedValue(mockWorkspace());
      memberRepo.addMember.mockResolvedValue(mockMember());

      const result = await service.createWorkspace(actor, 'main', 'Main');
      expect(result.name).toBe('Main');
      expect(workspaceRepo.create).toHaveBeenCalledOnce();
      expect(memberRepo.addMember).toHaveBeenCalledOnce();
    });

    it('throws ConflictException when slug is taken', async () => {
      workspaceRepo.findBySlug.mockResolvedValue(mockWorkspace());
      await expect(service.createWorkspace(actor, 'main', 'Main')).rejects.toThrow(
        ConflictException,
      );
    });
  });

  // ── updateWorkspace ──────────────────────────────────────────────────────────

  describe('updateWorkspace', () => {
    it('updates workspace', async () => {
      workspaceRepo.findById.mockResolvedValue(mockWorkspace());
      workspaceRepo.update.mockResolvedValue(mockWorkspace({ name: 'Updated' }));

      const result = await service.updateWorkspace('ws-1', { name: 'Updated' });
      expect(result.name).toBe('Updated');
    });

    it('throws when workspace not found', async () => {
      workspaceRepo.findById.mockResolvedValue(null);
      await expect(service.updateWorkspace('missing', {})).rejects.toThrow(NotFoundException);
    });
  });

  // ── deleteWorkspace ──────────────────────────────────────────────────────────

  describe('deleteWorkspace', () => {
    it('soft-deletes workspace', async () => {
      workspaceRepo.findById.mockResolvedValue(mockWorkspace());
      await service.deleteWorkspace('ws-1');
      expect(workspaceRepo.softDelete).toHaveBeenCalledWith('ws-1');
    });
  });

  // ── addMember ────────────────────────────────────────────────────────────────

  describe('addMember', () => {
    it('adds member when not already a member', async () => {
      workspaceRepo.findById.mockResolvedValue(mockWorkspace());
      memberRepo.findMember.mockResolvedValue(null);
      memberRepo.addMember.mockResolvedValue(mockMember());

      const result = await service.addMember('ws-1', 'user-2', 'actor-1');
      expect(result.userId).toBe('user-1');
    });

    it('throws ConflictException if user is already a member', async () => {
      workspaceRepo.findById.mockResolvedValue(mockWorkspace());
      memberRepo.findMember.mockResolvedValue(mockMember());

      await expect(service.addMember('ws-1', 'user-1', 'actor-1')).rejects.toThrow(
        ConflictException,
      );
    });
  });

  // ── updateMember ─────────────────────────────────────────────────────────────

  describe('updateMember', () => {
    it('updates member status', async () => {
      workspaceRepo.findById.mockResolvedValue(mockWorkspace());
      memberRepo.findMemberById.mockResolvedValue(mockMember());
      memberRepo.updateMember.mockResolvedValue(mockMember({ status: 'suspended' }));

      const result = await service.updateMember(
        'ws-1',
        'member-1',
        { status: 'suspended' },
        'actor-1',
      );
      expect(result.status).toBe('suspended');
    });

    it('throws SOLE_ADMIN_VIOLATION when suspending the last admin', async () => {
      workspaceRepo.findById.mockResolvedValue(mockWorkspace());
      memberRepo.findMemberById.mockResolvedValue(mockMember());
      memberRepo.isActiveAdmin.mockResolvedValue(true);
      memberRepo.countActiveAdmins.mockResolvedValue(1);

      await expect(
        service.updateMember('ws-1', 'member-1', { status: 'suspended' }, 'actor-1'),
      ).rejects.toThrow(PreconditionFailedException);
    });

    it('throws NotFoundException when member not in workspace', async () => {
      workspaceRepo.findById.mockResolvedValue(mockWorkspace());
      memberRepo.findMemberById.mockResolvedValue(mockMember({ workspaceId: 'other' }));

      await expect(
        service.updateMember('ws-1', 'member-1', { status: 'suspended' }, 'actor-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── removeMember ─────────────────────────────────────────────────────────────

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

    it('throws SOLE_ADMIN_VIOLATION when removing the last admin', async () => {
      workspaceRepo.findById.mockResolvedValue(mockWorkspace());
      memberRepo.findMember.mockResolvedValue(mockMember());
      memberRepo.isActiveAdmin.mockResolvedValue(true);
      memberRepo.countActiveAdmins.mockResolvedValue(1);

      await expect(service.removeMember('ws-1', 'user-1', 'actor-1')).rejects.toThrow(
        PreconditionFailedException,
      );
    });
  });

  // ── inviteMember ─────────────────────────────────────────────────────────────

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

  // ── cancelInvitation ─────────────────────────────────────────────────────────

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

  // ── acceptInvitation ─────────────────────────────────────────────────────────

  describe('acceptInvitation', () => {
    it('accepts pending invitation and adds member', async () => {
      invitationRepo.findByTokenHash.mockResolvedValue(mockInvitation({ status: 'pending' }));
      memberRepo.findMember.mockResolvedValue(null);
      memberRepo.addMember.mockResolvedValue(mockMember());

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
========
>>>>>>>> 9af2412 (feat: Phase 3 — tasks table, defect lifecycle, milestones, UI polish & bug fixes):libs/modules/tenancy/src/application/tenancy.service.spec.ts
});
