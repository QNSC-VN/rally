import { Test, TestingModule } from '@nestjs/testing';
import { TenancyService } from './tenancy.service';
import { TENANT_REPOSITORY, ITenantRepository } from '../domain/ports/tenant.repository';
import { WORKSPACE_REPOSITORY, IWorkspaceRepository } from '../domain/ports/workspace.repository';
import {
  WORKSPACE_MEMBER_REPOSITORY,
  IWorkspaceMemberRepository,
} from '../domain/ports/workspace-member.repository';
import {
  WORKSPACE_INVITATION_REPOSITORY,
  IWorkspaceInvitationRepository,
} from '../domain/ports/workspace-invitation.repository';
import {
  WORKSPACE_SETTINGS_REPOSITORY,
  IWorkspaceSettingsRepository,
} from '../domain/ports/workspace-settings.repository';
import {
  TENANT_DOMAIN_REPOSITORY,
  ITenantDomainRepository,
} from '../domain/ports/tenant-domain.repository';
import {
  TENANT_MEMBER_REPOSITORY,
  ITenantMemberRepository,
} from '../domain/ports/tenant-member.repository';
import type {
  Tenant,
  Workspace,
  WorkspaceMember,
  WorkspaceInvitation,
} from '../domain/tenancy.types';
import {
  NotFoundException,
  ConflictException,
  AppConfigService,
  EmailSchedulerService,
  UnitOfWork,
  TenantRlsService,
} from '@platform';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const now = new Date('2024-06-01');

const mockTenant = (o: Partial<Tenant> = {}): Tenant => ({
  id: 'tenant-1',
  slug: 'acme',
  name: 'Acme Corp',
  status: 'active',
  plan: 'free',
  settings: {},
  createdAt: now,
  updatedAt: now,
  deletedAt: null,
  ...o,
});

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

const mockInvitation = (o: Partial<WorkspaceInvitation> = {}): WorkspaceInvitation => ({
  id: 'inv-1',
  tenantId: 'tenant-1',
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

const makeTenantRepo = (): jest.Mocked<ITenantRepository> =>
  ({
    findById: vi.fn(),
    findBySlug: vi.fn(),
    create: vi.fn(),
  }) as unknown as jest.Mocked<ITenantRepository>;

const makeWorkspaceRepo = (): jest.Mocked<IWorkspaceRepository> =>
  ({
    findById: vi.fn(),
    findBySlug: vi.fn(),
    listByTenant: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    softDelete: vi.fn().mockResolvedValue(undefined),
  }) as unknown as jest.Mocked<IWorkspaceRepository>;

const makeMemberRepo = (): jest.Mocked<IWorkspaceMemberRepository> =>
  ({
    findMember: vi.fn(),
    listMembers: vi.fn(),
    addMember: vi.fn(),
    updateMember: vi.fn(),
    removeMember: vi.fn().mockResolvedValue(undefined),
  }) as unknown as jest.Mocked<IWorkspaceMemberRepository>;

const makeInvitationRepo = (): jest.Mocked<IWorkspaceInvitationRepository> =>
  ({
    findByTokenHash: vi.fn(),
    findById: vi.fn(),
    findPendingByEmail: vi.fn(),
    listByWorkspace: vi.fn(),
    create: vi.fn(),
    updateStatus: vi.fn().mockResolvedValue(undefined),
    cancelExistingForEmail: vi.fn().mockResolvedValue(undefined),
  }) as unknown as jest.Mocked<IWorkspaceInvitationRepository>;

const makeSettingsRepo = (): jest.Mocked<IWorkspaceSettingsRepository> =>
  ({
    findByWorkspace: vi.fn(),
    upsert: vi.fn(),
  }) as unknown as jest.Mocked<IWorkspaceSettingsRepository>;

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

const makeTenantDomainRepo = (): jest.Mocked<ITenantDomainRepository> => ({
  findByDomain: vi.fn().mockResolvedValue(null),
  create: vi
    .fn()
    .mockResolvedValue({ id: 'domain-1', domain: 'example.com', tenantId: 'tenant-1' }),
});

const makeTenantMemberRepo = (): jest.Mocked<ITenantMemberRepository> => ({
  findByUserId: vi.fn().mockResolvedValue([]),
  findByUserAndTenant: vi.fn().mockResolvedValue(null),
  create: vi.fn().mockResolvedValue(undefined),
  touchLastActive: vi.fn().mockResolvedValue(undefined),
});

const makeRls = () => ({
  withTenantContext: vi.fn((_tenantId: string, fn: (tx: unknown) => unknown) => fn({})),
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('TenancyService', () => {
  let service: TenancyService;
  let tenantRepo: ReturnType<typeof makeTenantRepo>;
  let workspaceRepo: ReturnType<typeof makeWorkspaceRepo>;
  let memberRepo: ReturnType<typeof makeMemberRepo>;
  let invitationRepo: ReturnType<typeof makeInvitationRepo>;
  let settingsRepo: ReturnType<typeof makeSettingsRepo>;
  let tenantDomainRepo: ReturnType<typeof makeTenantDomainRepo>;
  let tenantMemberRepo: ReturnType<typeof makeTenantMemberRepo>;
  let emailScheduler: ReturnType<typeof makeEmailScheduler>;
  let uow: ReturnType<typeof makeUow>;
  let rls: ReturnType<typeof makeRls>;

  beforeEach(async () => {
    tenantRepo = makeTenantRepo();
    workspaceRepo = makeWorkspaceRepo();
    memberRepo = makeMemberRepo();
    invitationRepo = makeInvitationRepo();
    settingsRepo = makeSettingsRepo();
    tenantDomainRepo = makeTenantDomainRepo();
    tenantMemberRepo = makeTenantMemberRepo();
    emailScheduler = makeEmailScheduler();
    uow = makeUow();
    rls = makeRls();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TenancyService,
        { provide: TENANT_REPOSITORY, useValue: tenantRepo },
        { provide: WORKSPACE_REPOSITORY, useValue: workspaceRepo },
        { provide: WORKSPACE_MEMBER_REPOSITORY, useValue: memberRepo },
        { provide: WORKSPACE_INVITATION_REPOSITORY, useValue: invitationRepo },
        { provide: WORKSPACE_SETTINGS_REPOSITORY, useValue: settingsRepo },
        { provide: TENANT_DOMAIN_REPOSITORY, useValue: tenantDomainRepo },
        { provide: TENANT_MEMBER_REPOSITORY, useValue: tenantMemberRepo },
        { provide: AppConfigService, useValue: makeConfig() },
        { provide: EmailSchedulerService, useValue: emailScheduler },
        { provide: UnitOfWork, useValue: uow },
        { provide: TenantRlsService, useValue: rls },
      ],
    }).compile();

    service = module.get(TenancyService);
  });

  // ── getTenant ──────────────────────────────────────────────────────────────

  describe('getTenant', () => {
    it('returns tenant when found', async () => {
      tenantRepo.findById.mockResolvedValue(mockTenant());
      const result = await service.getTenant('tenant-1');
      expect(result.slug).toBe('acme');
    });

    it('throws NotFoundException when not found', async () => {
      tenantRepo.findById.mockResolvedValue(null);
      await expect(service.getTenant('missing')).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when deleted', async () => {
      tenantRepo.findById.mockResolvedValue(mockTenant({ deletedAt: now }));
      await expect(service.getTenant('tenant-1')).rejects.toThrow(NotFoundException);
    });
  });

  // ── getWorkspace ───────────────────────────────────────────────────────────

  describe('getWorkspace', () => {
    it('returns workspace when found and belongs to tenant', async () => {
      workspaceRepo.findById.mockResolvedValue(mockWorkspace());
      const result = await service.getWorkspace('tenant-1', 'ws-1');
      expect(result.name).toBe('Main');
    });

    it('throws NotFoundException when not found', async () => {
      workspaceRepo.findById.mockResolvedValue(null);
      await expect(service.getWorkspace('tenant-1', 'missing')).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when workspace belongs to different tenant', async () => {
      workspaceRepo.findById.mockResolvedValue(mockWorkspace({ tenantId: 'other-tenant' }));
      await expect(service.getWorkspace('tenant-1', 'ws-1')).rejects.toThrow(NotFoundException);
    });
  });

  // ── createWorkspace ────────────────────────────────────────────────────────

  describe('createWorkspace', () => {
    const actor = {
      sub: 'user-1',
      tenantId: 'tenant-1',
      sessionId: 's1',
      jti: 'j1',
      iat: 0,
      exp: 0,
      iss: '',
      aud: '',
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

  // ── updateWorkspace ────────────────────────────────────────────────────────

  describe('updateWorkspace', () => {
    it('updates workspace', async () => {
      workspaceRepo.findById.mockResolvedValue(mockWorkspace());
      workspaceRepo.update.mockResolvedValue(mockWorkspace({ name: 'Updated' }));

      const result = await service.updateWorkspace('tenant-1', 'ws-1', { name: 'Updated' });
      expect(result.name).toBe('Updated');
    });

    it('throws when workspace not found', async () => {
      workspaceRepo.findById.mockResolvedValue(null);
      await expect(service.updateWorkspace('tenant-1', 'missing', {})).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ── deleteWorkspace ────────────────────────────────────────────────────────

  describe('deleteWorkspace', () => {
    it('soft-deletes workspace', async () => {
      workspaceRepo.findById.mockResolvedValue(mockWorkspace());
      await service.deleteWorkspace('tenant-1', 'ws-1');
      expect(workspaceRepo.softDelete).toHaveBeenCalledWith('ws-1');
    });
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
      expect(memberRepo.removeMember).toHaveBeenCalledWith('ws-1', 'user-1');
    });

    it('throws NotFoundException if user is not a member', async () => {
      workspaceRepo.findById.mockResolvedValue(mockWorkspace());
      memberRepo.findMember.mockResolvedValue(null);

      await expect(service.removeMember('tenant-1', 'ws-1', 'user-99', 'actor-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ── inviteMember ───────────────────────────────────────────────────────────

  describe('inviteMember', () => {
    it('creates invitation and sends email', async () => {
      workspaceRepo.findById.mockResolvedValue(mockWorkspace());
      invitationRepo.create.mockResolvedValue(mockInvitation());

      const result = await service.inviteMember(
        'tenant-1',
        'ws-1',
        'bob@example.com',
        undefined,
        'actor-1',
      );

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

      await service.inviteMember('tenant-1', 'ws-1', 'BOB@Example.com', undefined, 'actor-1');

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

      await service.cancelInvitation('tenant-1', 'ws-1', 'inv-1', 'actor-1');

      expect(invitationRepo.updateStatus).toHaveBeenCalledWith('inv-1', 'cancelled');
    });

    it('throws NotFoundException when invitation not found', async () => {
      workspaceRepo.findById.mockResolvedValue(mockWorkspace());
      invitationRepo.findById.mockResolvedValue(null);

      await expect(
        service.cancelInvitation('tenant-1', 'ws-1', 'inv-missing', 'actor-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── acceptInvitation ───────────────────────────────────────────────────────

  describe('acceptInvitation', () => {
    it('accepts pending invitation and adds member', async () => {
      invitationRepo.findByTokenHash.mockResolvedValue(mockInvitation({ status: 'pending' }));
      workspaceRepo.findById.mockResolvedValue(mockWorkspace());
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
});
