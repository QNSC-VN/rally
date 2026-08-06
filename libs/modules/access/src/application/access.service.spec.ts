import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mocked } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { UnitOfWork, AuditProducer, DRIZZLE } from '@platform';
import { CacheService } from '@qnsc-vn/platform-cache';
import { AccessService } from './access.service';
import { ROLE_REPOSITORY, IRoleRepository } from '../domain/ports/role.repository';
import {
  ROLE_ASSIGNMENT_REPOSITORY,
  IRoleAssignmentRepository,
} from '../domain/ports/role-assignment.repository';
import type {
  SystemRole,
  UserRoleAssignment,
  ScopeType,
  EffectiveAssignment,
} from '../domain/access.types';

// ── Fixtures ─────────────────────────────────────────────────────────────────

let projectMemberRows: Array<{ projectId: string }> = [];

const WORKSPACE = 'ws-1';
const USER = 'user-1';

const role = (slug: string, permissions: string[]): SystemRole => ({
  id: `role-${slug}`,
  workspaceId: null,
  name: slug,
  slug,
  description: null,
  isSystem: true,
  permissions,
  createdAt: new Date(),
});

const assignment = (
  roleId: string,
  scopeType: ScopeType,
  scopeId: string | null = null,
): UserRoleAssignment => ({
  id: `a-${roleId}-${scopeType}-${scopeId ?? 'none'}`,
  workspaceId: WORKSPACE,
  userId: USER,
  roleId,
  scopeType,
  scopeId,
  grantedBy: null,
  createdAt: new Date(),
});

/** A role joined with a scope — the shape returned by listEffectiveForUser. */
const eff = (
  r: SystemRole,
  scopeType: ScopeType,
  scopeId: string | null = null,
): EffectiveAssignment => ({
  scopeType,
  scopeId,
  roleSlug: r.slug,
  permissions: r.permissions,
});

describe('AccessService — scope-aware permission resolution', () => {
  let service: AccessService;
  let roleRepo: Mocked<IRoleRepository>;
  let assignmentRepo: Mocked<IRoleAssignmentRepository>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AccessService,
        {
          provide: ROLE_REPOSITORY,
          useValue: {
            findById: vi.fn(),
            listForWorkspace: vi.fn().mockResolvedValue([]),
            updatePermissions: vi.fn(),
            create: vi.fn(),
            delete: vi.fn(),
          },
        },
        {
          provide: ROLE_ASSIGNMENT_REPOSITORY,
          useValue: {
            findById: vi.fn(),
            findExisting: vi.fn(),
            listForUser: vi.fn(),
            listEffectiveForUser: vi.fn(),
            listUserIdsForRole: vi.fn().mockResolvedValue([]),
            create: vi.fn(),
            delete: vi.fn(),
          },
        },
        { provide: UnitOfWork, useValue: { run: vi.fn((fn: (tx: unknown) => unknown) => fn({})) } },
        { provide: AuditProducer, useValue: { emit: vi.fn().mockResolvedValue(undefined) } },
        {
          // `listReadableProjectIds` reads project_members directly (no port exists for
          // the roster). Chainable stub; `projectMemberRows` is what each test controls.
          provide: DRIZZLE,
          useValue: {
            select: () => ({
              from: () => ({
                innerJoin: () => ({
                  where: () => Promise.resolve(projectMemberRows),
                }),
              }),
            }),
          },
        },
        {
          provide: CacheService,
          useValue: {
            // Always a miss, so every resolution reaches the repository mocks the
            // assertions below are written against.
            getJson: vi.fn().mockResolvedValue(null),
            setJson: vi.fn().mockResolvedValue(undefined),
            del: vi.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    service = module.get(AccessService);
    roleRepo = module.get(ROLE_REPOSITORY);
    assignmentRepo = module.get(ROLE_ASSIGNMENT_REPOSITORY);
    // Default: the acting user is a workspace admin. Escalation checks now resolve
    // the ACTOR's own permissions from the database instead of reading the token,
    // so tests that exercise a write need a resolvable actor; the no-escalation
    // cases narrow this deliberately.
    projectMemberRows = [];
    assignmentRepo.listEffectiveForUser.mockResolvedValue([
      {
        scopeType: 'workspace',
        scopeId: null,
        roleSlug: 'workspace_admin',
        permissions: ['workspace:*'],
      },
    ] as never);
  });

  describe('listReadableProjectIds — the boundary behind every cross-project list', () => {
    // Mirrors Rally, where access to an artifact follows from permission on its PROJECT
    // rather than any per-artifact grant. Getting this wrong leaks another project's data,
    // so each source and each degenerate case is asserted separately.

    it('returns null (unrestricted) for a workspace-wide wildcard', () => {
      // `workspace:*` is Rally's Workspace Admin — every project, no filter.
      // null, not "every id": enumerating projects would race with project creation.
      return expect(
        service.listReadableProjectIds(WORKSPACE, USER, 'portfolio:view'),
      ).resolves.toBeNull();
    });

    it('returns null for an explicit workspace-tier grant of the same permission', async () => {
      assignmentRepo.listEffectiveForUser.mockResolvedValue([
        {
          scopeType: 'workspace',
          scopeId: null,
          roleSlug: 'custom',
          permissions: ['portfolio:view'],
        },
      ] as never);
      await expect(
        service.listReadableProjectIds(WORKSPACE, USER, 'portfolio:view'),
      ).resolves.toBeNull();
    });

    it('returns only the projects a project-scoped role grants', async () => {
      assignmentRepo.listEffectiveForUser.mockResolvedValue([
        {
          scopeType: 'project',
          scopeId: 'proj-a',
          roleSlug: 'project_admin',
          permissions: ['portfolio:view'],
        },
        {
          scopeType: 'project',
          scopeId: 'proj-b',
          roleSlug: 'project_member',
          permissions: ['work_item:view'],
        },
      ] as never);

      const ids = await service.listReadableProjectIds(WORKSPACE, USER, 'portfolio:view');
      // proj-b is excluded: the role there does not grant THIS permission. A grant on
      // one project must never imply the same grant elsewhere.
      expect(ids).toEqual(['proj-a']);
    });

    it('unions project-scoped roles with active project membership', async () => {
      assignmentRepo.listEffectiveForUser.mockResolvedValue([
        {
          scopeType: 'project',
          scopeId: 'proj-a',
          roleSlug: 'project_admin',
          permissions: ['portfolio:view'],
        },
      ] as never);
      projectMemberRows = [{ projectId: 'proj-c' }];

      const ids = await service.listReadableProjectIds(WORKSPACE, USER, 'portfolio:view');
      expect(ids?.sort()).toEqual(['proj-a', 'proj-c']);
    });

    it('de-duplicates a project reachable through both sources', async () => {
      assignmentRepo.listEffectiveForUser.mockResolvedValue([
        {
          scopeType: 'project',
          scopeId: 'proj-a',
          roleSlug: 'project_admin',
          permissions: ['portfolio:view'],
        },
      ] as never);
      projectMemberRows = [{ projectId: 'proj-a' }];

      // A duplicate id would make `inArray` redundant rather than wrong, but a caller
      // counting the result would be misled.
      expect(await service.listReadableProjectIds(WORKSPACE, USER, 'portfolio:view')).toEqual([
        'proj-a',
      ]);
    });

    it('returns an EMPTY ARRAY, not null, when nothing is readable', async () => {
      // The distinction that keeps this fail-closed: [] means "no projects" and must
      // return no rows, while null means "all". A caller conflating them opens a leak.
      assignmentRepo.listEffectiveForUser.mockResolvedValue([] as never);
      const ids = await service.listReadableProjectIds(WORKSPACE, USER, 'portfolio:view');
      expect(ids).toEqual([]);
      expect(ids).not.toBeNull();
    });

    it('honours a namespace wildcard on a project-scoped role', async () => {
      assignmentRepo.listEffectiveForUser.mockResolvedValue([
        {
          scopeType: 'project',
          scopeId: 'proj-a',
          roleSlug: 'custom',
          permissions: ['portfolio:*'],
        },
      ] as never);
      // Same wildcard semantics the guard applies, so the two cannot disagree about
      // what a grant means.
      await expect(
        service.listReadableProjectIds(WORKSPACE, USER, 'portfolio:view'),
      ).resolves.toEqual(['proj-a']);
    });

    it('ignores a project assignment with a null scopeId', async () => {
      // Defensive: scope_id is nullable in the schema (global scope uses null), so a
      // malformed project-scoped row must not become a filter of `[null]`.
      assignmentRepo.listEffectiveForUser.mockResolvedValue([
        {
          scopeType: 'project',
          scopeId: null,
          roleSlug: 'custom',
          permissions: ['portfolio:view'],
        },
      ] as never);
      await expect(
        service.listReadableProjectIds(WORKSPACE, USER, 'portfolio:view'),
      ).resolves.toEqual([]);
    });
  });

  describe('getUserRoleAndPermissions (workspace baseline)', () => {
    it('falls back to a minimal baseline (empty role) when the user has no assignments', async () => {
      assignmentRepo.listEffectiveForUser.mockResolvedValue([]);
      const result = await service.getUserRoleAndPermissions(USER, WORKSPACE);
      // workspace_member role was removed in Phase 4.2; a user with no
      // assignment reports an empty representative role + the minimal read
      // baseline (project delivery access is granted per-project by a role).
      expect(result.role).toBe('');
      expect(result.permissions).toEqual(['workspace:view', 'project:view']);
    });

    it('unions permissions across multiple baseline (workspace + global) roles', async () => {
      const member = role('project_member', ['work_item:edit', 'project:view']);
      const globalRole = role('some_global', ['audit:view', 'project:view']);
      assignmentRepo.listEffectiveForUser.mockResolvedValue([
        eff(member, 'workspace'),
        eff(globalRole, 'global'),
      ]);

      const result = await service.getUserRoleAndPermissions(USER, WORKSPACE);
      // deduped union of both roles
      expect(new Set(result.permissions)).toEqual(
        new Set(['work_item:edit', 'project:view', 'audit:view']),
      );
      // representative role prefers the global-scoped one
      expect(result.role).toBe('some_global');
    });

    it('excludes project-scoped assignments from the baseline', async () => {
      const workspaceRole = role('project_viewer', ['work_item:view']);
      const projectRole = role('project_admin', ['project:edit', 'project:manage_members']);
      assignmentRepo.listEffectiveForUser.mockResolvedValue([
        eff(workspaceRole, 'workspace'),
        eff(projectRole, 'project', 'proj-9'),
      ]);

      const result = await service.getUserRoleAndPermissions(USER, WORKSPACE);
      // project-scoped project:edit must NOT leak into the workspace-wide baseline
      expect(result.permissions).toEqual(['work_item:view']);
    });
  });

  describe('getProjectPermissions (per-project resolution)', () => {
    it('unions baseline with the role scoped to the requested project', async () => {
      const workspaceRole = role('project_viewer', ['work_item:view', 'project:view']);
      const projectRole = role('project_admin', ['project:edit', 'project:manage_members']);
      assignmentRepo.listEffectiveForUser.mockResolvedValue([
        eff(workspaceRole, 'workspace'),
        eff(projectRole, 'project', 'proj-9'),
      ]);

      const perms = await service.getProjectPermissions(USER, WORKSPACE, 'proj-9');
      expect(new Set(perms)).toEqual(
        new Set(['work_item:view', 'project:view', 'project:edit', 'project:manage_members']),
      );
    });

    it('does NOT include a role scoped to a different project', async () => {
      const workspaceRole = role('project_viewer', ['work_item:view']);
      const projectRole = role('project_admin', ['project:edit']);
      assignmentRepo.listEffectiveForUser.mockResolvedValue([
        eff(workspaceRole, 'workspace'),
        eff(projectRole, 'project', 'proj-OTHER'),
      ]);

      const perms = await service.getProjectPermissions(USER, WORKSPACE, 'proj-9');
      // project:edit belongs to a different project — must not apply here
      expect(perms).toEqual(['work_item:view']);
    });
  });

  describe('assertProjectPermission', () => {
    const actor = (permissions: string[]) =>
      ({ sub: USER, workspaceId: WORKSPACE, permissions }) as never;

    it('passes on a workspace wildcard, resolved from the database', async () => {
      // There is no token fast path any more: `getProjectPermissions` unions the
      // workspace baseline, so a workspace-wide holder passes via resolution.
      const adminRole = role('workspace_admin', ['workspace:*']);
      assignmentRepo.listEffectiveForUser.mockResolvedValue([eff(adminRole, 'workspace')]);

      await expect(
        service.assertProjectPermission(actor([]), 'proj-9', 'release:edit'),
      ).resolves.toBeUndefined();
      expect(assignmentRepo.listEffectiveForUser).toHaveBeenCalledWith(WORKSPACE, USER);
    });

    it('passes when the project-scoped role grants the permission', async () => {
      const projectRole = role('project_admin', ['release:edit']);
      assignmentRepo.listEffectiveForUser.mockResolvedValue([
        eff(projectRole, 'project', 'proj-9'),
      ]);

      await expect(
        service.assertProjectPermission(actor([]), 'proj-9', 'release:edit'),
      ).resolves.toBeUndefined();
    });

    it('throws when neither baseline nor project scope grants it', async () => {
      const otherProjectRole = role('project_admin', ['release:edit']);
      assignmentRepo.listEffectiveForUser.mockResolvedValue([
        eff(otherProjectRole, 'project', 'proj-OTHER'),
      ]);

      await expect(
        service.assertProjectPermission(actor([]), 'proj-9', 'release:edit'),
      ).rejects.toMatchObject({ code: 'PROJECT_PERMISSION_DENIED' });
    });
  });

  describe('assignProjectRole (project-scoped grant)', () => {
    const actor = { sub: USER, workspaceId: WORKSPACE, permissions: [] } as never;

    it('rejects a role that carries any workspace-tier permission', async () => {
      roleRepo.findById.mockResolvedValue(role('workspace_admin', ['workspace:*']));

      await expect(
        service.assignProjectRole(actor, 'proj-9', 'user-2', 'role-workspace_admin'),
      ).rejects.toMatchObject({ code: 'CANNOT_GRANT_WORKSPACE_ROLE' });
      expect(assignmentRepo.create).not.toHaveBeenCalled();
    });

    it('assigns a project-tier role scoped to the project', async () => {
      roleRepo.findById.mockResolvedValue(
        role('project_admin', ['project:edit', 'project:manage_members']),
      );
      assignmentRepo.findExisting.mockResolvedValue(null);
      assignmentRepo.create.mockImplementation(async (input) => ({
        id: input.id,
        workspaceId: input.workspaceId,
        userId: input.userId,
        roleId: input.roleId,
        scopeType: input.scopeType,
        scopeId: input.scopeId ?? null,
        grantedBy: input.grantedBy,
        createdAt: new Date(),
      }));

      const result = await service.assignProjectRole(actor, 'proj-9', 'user-2', 'role-x');
      expect(assignmentRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ scopeType: 'project', scopeId: 'proj-9', userId: 'user-2' }),
        expect.anything(),
      );
      expect(result.scopeType).toBe('project');
      expect(result.scopeId).toBe('proj-9');
    });
  });

  describe('revokeProjectRole (project-scoped revoke)', () => {
    const actor = { sub: USER, workspaceId: WORKSPACE, permissions: [] } as never;

    it('throws when the assignment is not scoped to a project', async () => {
      assignmentRepo.findById.mockResolvedValue(assignment('role-x', 'workspace'));

      await expect(service.revokeProjectRole(actor, 'proj-9', 'a-1')).rejects.toMatchObject({
        code: 'ROLE_ASSIGNMENT_NOT_FOUND',
      });
      expect(assignmentRepo.delete).not.toHaveBeenCalled();
    });

    it('throws when the assignment belongs to a different project', async () => {
      assignmentRepo.findById.mockResolvedValue(assignment('role-x', 'project', 'proj-OTHER'));

      await expect(service.revokeProjectRole(actor, 'proj-9', 'a-1')).rejects.toMatchObject({
        code: 'ROLE_ASSIGNMENT_NOT_FOUND',
      });
      expect(assignmentRepo.delete).not.toHaveBeenCalled();
    });

    it('deletes the assignment when it is scoped to this project', async () => {
      assignmentRepo.findById.mockResolvedValue(assignment('role-x', 'project', 'proj-9'));

      await service.revokeProjectRole(actor, 'proj-9', 'a-1');
      expect(assignmentRepo.delete).toHaveBeenCalledWith('a-1', expect.anything());
    });
  });

  describe('updateRolePermissions', () => {
    // workspace_admin (workspace:*) — holds every code, so the no-escalation
    // guard is satisfied and these tests exercise the rest of the method.
    const actor = { sub: USER, workspaceId: WORKSPACE, permissions: ['workspace:*'] } as never;
    const customRole = (overrides: Partial<SystemRole> = {}): SystemRole => ({
      id: 'role-custom',
      workspaceId: WORKSPACE,
      name: 'Custom',
      slug: 'custom',
      description: null,
      isSystem: false,
      permissions: ['project:view'],
      createdAt: new Date(),
      ...overrides,
    });

    it('rejects a permission the actor does not themselves hold (no escalation)', async () => {
      roleRepo.findById.mockResolvedValue(customRole());
      // Narrow what the ACTOR resolves to — a token-carried list would no longer
      // matter, which is the point: escalation is judged on live grants.
      assignmentRepo.listEffectiveForUser.mockResolvedValue([
        eff(role('project_member', ['work_item:view']), 'workspace'),
      ]);
      const weakActor = { sub: USER, workspaceId: WORKSPACE } as never;
      await expect(
        service.updateRolePermissions(weakActor, 'role-custom', ['project:delete']),
      ).rejects.toMatchObject({ code: 'ROLE_PERMISSION_ESCALATION' });
      expect(roleRepo.updatePermissions).not.toHaveBeenCalled();
    });

    it('throws ROLE_NOT_FOUND when the role does not exist', async () => {
      roleRepo.findById.mockResolvedValue(null);
      await expect(
        service.updateRolePermissions(actor, 'role-custom', ['project:edit']),
      ).rejects.toMatchObject({ code: 'ROLE_NOT_FOUND' });
      expect(roleRepo.updatePermissions).not.toHaveBeenCalled();
    });

    it('throws ROLE_NOT_FOUND when the role belongs to another workspace', async () => {
      roleRepo.findById.mockResolvedValue(customRole({ workspaceId: 'ws-OTHER' }));
      await expect(
        service.updateRolePermissions(actor, 'role-custom', ['project:edit']),
      ).rejects.toMatchObject({ code: 'ROLE_NOT_FOUND' });
      expect(roleRepo.updatePermissions).not.toHaveBeenCalled();
    });

    it('throws ROLE_IMMUTABLE for built-in system roles', async () => {
      roleRepo.findById.mockResolvedValue(customRole({ isSystem: true }));
      await expect(
        service.updateRolePermissions(actor, 'role-custom', ['project:edit']),
      ).rejects.toMatchObject({ code: 'ROLE_IMMUTABLE' });
      expect(roleRepo.updatePermissions).not.toHaveBeenCalled();
    });

    it('throws ROLE_IMMUTABLE for global (workspaceId=null) roles', async () => {
      roleRepo.findById.mockResolvedValue(customRole({ workspaceId: null, isSystem: false }));
      await expect(
        service.updateRolePermissions(actor, 'role-custom', ['project:edit']),
      ).rejects.toMatchObject({ code: 'ROLE_IMMUTABLE' });
      expect(roleRepo.updatePermissions).not.toHaveBeenCalled();
    });

    it('dedupes + sorts the permission set and persists it for a custom role', async () => {
      const existing = customRole();
      roleRepo.findById.mockResolvedValue(existing);
      roleRepo.updatePermissions.mockImplementation(async (id, permissions) => ({
        ...existing,
        id,
        permissions,
      }));

      const result = await service.updateRolePermissions(actor, 'role-custom', [
        'project:edit',
        'project:view',
        'project:edit',
      ]);

      expect(roleRepo.updatePermissions).toHaveBeenCalledWith(
        'role-custom',
        ['project:edit', 'project:view'],
        expect.anything(),
      );
      expect(result.permissions).toEqual(['project:edit', 'project:view']);
    });
  });

  describe('createRole', () => {
    const admin = { sub: USER, workspaceId: WORKSPACE, permissions: ['workspace:*'] } as never;
    const saved = (overrides: Partial<SystemRole> = {}): SystemRole => ({
      id: 'role-new',
      workspaceId: WORKSPACE,
      name: 'QA Lead',
      slug: 'qa_lead',
      description: null,
      isSystem: false,
      permissions: ['quality:view'],
      createdAt: new Date(),
      ...overrides,
    });

    it('creates a workspace custom role with a derived, unique slug', async () => {
      roleRepo.listForWorkspace.mockResolvedValue([]);
      roleRepo.create.mockImplementation(async (input) =>
        saved({ slug: input.slug, name: input.name, permissions: input.permissions }),
      );

      const role = await service.createRole(admin, {
        name: 'QA Lead',
        permissions: ['quality:view'],
      });

      expect(role.slug).toBe('qa_lead');
      expect(role.isSystem).toBe(false);
      expect(roleRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: WORKSPACE,
          slug: 'qa_lead',
          permissions: ['quality:view'],
        }),
        expect.anything(),
      );
    });

    it('de-duplicates the slug against existing roles', async () => {
      roleRepo.listForWorkspace.mockResolvedValue([saved({ slug: 'qa_lead' })]);
      roleRepo.create.mockImplementation(async (input) => saved({ slug: input.slug }));
      await service.createRole(admin, { name: 'QA Lead', permissions: [] });
      expect(roleRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ slug: 'qa_lead_2' }),
        expect.anything(),
      );
    });

    it('rejects a wildcard permission', async () => {
      await expect(
        service.createRole(admin, { name: 'Super', permissions: ['workspace:*'] }),
      ).rejects.toMatchObject({ code: 'ROLE_WILDCARD_FORBIDDEN' });
      expect(roleRepo.create).not.toHaveBeenCalled();
    });

    it('rejects a permission the creator does not hold (no escalation)', async () => {
      assignmentRepo.listEffectiveForUser.mockResolvedValue([
        eff(role('project_member', ['work_item:view']), 'workspace'),
      ]);
      const weak = { sub: USER, workspaceId: WORKSPACE } as never;
      await expect(
        service.createRole(weak, { name: 'X', permissions: ['project:delete'] }),
      ).rejects.toMatchObject({ code: 'ROLE_PERMISSION_ESCALATION' });
      expect(roleRepo.create).not.toHaveBeenCalled();
    });
  });

  describe('deleteRole', () => {
    const admin = { sub: USER, workspaceId: WORKSPACE, permissions: ['workspace:*'] } as never;
    const custom = (overrides: Partial<SystemRole> = {}): SystemRole => ({
      id: 'role-custom',
      workspaceId: WORKSPACE,
      name: 'Custom',
      slug: 'custom',
      description: null,
      isSystem: false,
      permissions: [],
      createdAt: new Date(),
      ...overrides,
    });

    it('deletes an unused custom role', async () => {
      roleRepo.findById.mockResolvedValue(custom());
      assignmentRepo.listUserIdsForRole.mockResolvedValue([]);
      await service.deleteRole(admin, 'role-custom');
      expect(roleRepo.delete).toHaveBeenCalledWith('role-custom', expect.anything());
    });

    it('blocks deleting a built-in system role', async () => {
      roleRepo.findById.mockResolvedValue(custom({ isSystem: true }));
      await expect(service.deleteRole(admin, 'role-custom')).rejects.toMatchObject({
        code: 'ROLE_IMMUTABLE',
      });
      expect(roleRepo.delete).not.toHaveBeenCalled();
    });

    it('blocks deleting a canonical tier role even as an editable workspace copy', async () => {
      // project_admin lives as an isSystem=false workspace copy, yet a tier role
      // must never be deletable — only its permissions may be tuned.
      roleRepo.findById.mockResolvedValue(custom({ slug: 'project_admin', isSystem: false }));
      await expect(service.deleteRole(admin, 'role-custom')).rejects.toMatchObject({
        code: 'ROLE_IMMUTABLE',
      });
      expect(roleRepo.delete).not.toHaveBeenCalled();
    });

    it('blocks deleting a role still assigned to users (409 ROLE_IN_USE)', async () => {
      roleRepo.findById.mockResolvedValue(custom());
      assignmentRepo.listUserIdsForRole.mockResolvedValue(['u1', 'u2']);
      await expect(service.deleteRole(admin, 'role-custom')).rejects.toMatchObject({
        code: 'ROLE_IN_USE',
      });
      expect(roleRepo.delete).not.toHaveBeenCalled();
    });

    it('throws ROLE_NOT_FOUND for another workspace’s role', async () => {
      roleRepo.findById.mockResolvedValue(custom({ workspaceId: 'ws-OTHER' }));
      await expect(service.deleteRole(admin, 'role-custom')).rejects.toMatchObject({
        code: 'ROLE_NOT_FOUND',
      });
    });
  });
});

/**
 * A permission change must invalidate the tokens that embed the old snapshot,
 * otherwise `PermissionGuard` keeps authorizing from it until the token expires
 * (up to JWT_ACCESS_EXPIRY). These tests pin *which* writes invalidate and which
 * deliberately do not.
 */
describe('AccessService — cached-permission invalidation', () => {
  let service: AccessService;
  let roleRepo: Mocked<IRoleRepository>;
  let assignmentRepo: Mocked<IRoleAssignmentRepository>;
  let cache: Mocked<CacheService>;

  const actor = {
    sub: 'admin-1',
    workspaceId: WORKSPACE,
    permissions: ['workspace:*'],
  } as unknown as Parameters<AccessService['assignRole']>[0];

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AccessService,
        {
          provide: ROLE_REPOSITORY,
          useValue: {
            findById: vi.fn(),
            listForWorkspace: vi.fn().mockResolvedValue([]),
            updatePermissions: vi.fn(),
            create: vi.fn(),
            delete: vi.fn(),
          },
        },
        {
          provide: ROLE_ASSIGNMENT_REPOSITORY,
          useValue: {
            findById: vi.fn(),
            findExisting: vi.fn().mockResolvedValue(null),
            listForUser: vi.fn().mockResolvedValue([]),
            listEffectiveForUser: vi.fn().mockResolvedValue([]),
            listUserIdsForRole: vi.fn().mockResolvedValue([]),
            create: vi.fn(),
            delete: vi.fn().mockResolvedValue(undefined),
          },
        },
        { provide: UnitOfWork, useValue: { run: vi.fn((fn: (tx: unknown) => unknown) => fn({})) } },
        { provide: AuditProducer, useValue: { emit: vi.fn().mockResolvedValue(undefined) } },
        {
          // `listReadableProjectIds` reads project_members directly (no port exists for
          // the roster). Chainable stub; `projectMemberRows` is what each test controls.
          provide: DRIZZLE,
          useValue: {
            select: () => ({
              from: () => ({
                innerJoin: () => ({
                  where: () => Promise.resolve(projectMemberRows),
                }),
              }),
            }),
          },
        },
        {
          provide: CacheService,
          useValue: {
            // Always a miss, so every resolution reaches the repository mocks the
            // assertions below are written against.
            getJson: vi.fn().mockResolvedValue(null),
            setJson: vi.fn().mockResolvedValue(undefined),
            del: vi.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    service = module.get(AccessService);
    roleRepo = module.get(ROLE_REPOSITORY);
    assignmentRepo = module.get(ROLE_ASSIGNMENT_REPOSITORY);
    cache = module.get(CacheService);
    // The acting admin's own permissions are resolved from the database now, so the
    // write paths under test need a resolvable actor.
    assignmentRepo.listEffectiveForUser.mockResolvedValue([
      {
        scopeType: 'workspace',
        scopeId: null,
        roleSlug: 'workspace_admin',
        permissions: ['workspace:*'],
      },
    ] as never);
  });

  it('invalidates the user when a workspace-scoped role is revoked', async () => {
    // This is the case that used to leave a revoked admin fully privileged for
    // up to 15 minutes.
    assignmentRepo.findById.mockResolvedValue(assignment('role-workspace_admin', 'workspace'));

    await service.revokeRole(actor, 'a-1');

    expect(cache.del).toHaveBeenCalledWith(`authz:assign:${WORKSPACE}:${USER}`);
  });

  it('invalidates the user when a workspace-scoped role is assigned', async () => {
    const target = role('workspace_admin', ['workspace:*']);
    roleRepo.findById.mockResolvedValue(target);
    assignmentRepo.create.mockResolvedValue(assignment(target.id, 'workspace'));

    await service.assignRole(actor, USER, target.id, 'workspace');

    expect(cache.del).toHaveBeenCalledWith(`authz:assign:${WORKSPACE}:${USER}`);
  });

  it('DOES invalidate for a project-scoped assignment', async () => {
    // The old token epoch skipped project scope, because project permissions were
    // never in the token. The cache holds the assignment rows BOTH tiers read, so
    // skipping it here would leave a project grant invisible for up to the TTL.
    const target = role('project_admin', ['project:edit']);
    roleRepo.findById.mockResolvedValue(target);
    assignmentRepo.create.mockResolvedValue(assignment(target.id, 'project', 'proj-9'));

    await service.assignRole(actor, USER, target.id, 'project', 'proj-9');

    expect(cache.del).toHaveBeenCalledWith(`authz:assign:${WORKSPACE}:${USER}`);
  });

  it('invalidates the permission cache when a project-scoped role is revoked', async () => {
    assignmentRepo.findById.mockResolvedValue(
      assignment('role-project_admin', 'project', 'proj-9'),
    );

    await service.revokeProjectRole(actor, 'proj-9', 'a-1');

    expect(cache.del).toHaveBeenCalledWith(`authz:assign:${WORKSPACE}:${USER}`);
  });

  it("invalidates every holder when a custom role's permissions change", async () => {
    const custom: SystemRole = {
      ...role('release_manager', ['release:create']),
      id: 'role-custom',
      workspaceId: WORKSPACE,
      isSystem: false,
    };
    roleRepo.findById.mockResolvedValue(custom);
    roleRepo.updatePermissions.mockResolvedValue({ ...custom, permissions: ['release:view'] });
    assignmentRepo.listUserIdsForRole.mockResolvedValue(['user-a', 'user-b']);

    await service.updateRolePermissions(actor, custom.id, ['release:view']);

    expect(assignmentRepo.listUserIdsForRole).toHaveBeenCalledWith(custom.id);
    expect(cache.del).toHaveBeenCalledWith(`authz:assign:${WORKSPACE}:user-a`);
    expect(cache.del).toHaveBeenCalledWith(`authz:assign:${WORKSPACE}:user-b`);
  });

  it('invalidates on elevation to workspace_admin', async () => {
    const admin = role('workspace_admin', ['workspace:*']);
    roleRepo.listForWorkspace.mockResolvedValue([admin]);
    assignmentRepo.listForUser.mockResolvedValue([]);
    assignmentRepo.create.mockResolvedValue(assignment(admin.id, 'workspace'));

    await expect(service.elevateToWorkspaceAdmin(USER, WORKSPACE)).resolves.toBe(true);

    expect(cache.del).toHaveBeenCalledWith(`authz:assign:${WORKSPACE}:${USER}`);
  });

  it('does not bump when a failed write throws before commit', async () => {
    // No role → NotFoundException before the transaction. A bump here would force
    // every holder of a nonexistent change to re-mint.
    roleRepo.findById.mockResolvedValue(null);

    await expect(service.assignRole(actor, USER, 'role-missing', 'workspace')).rejects.toThrow();

    expect(cache.del).not.toHaveBeenCalled();
  });
});
