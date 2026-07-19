import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mocked } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { UnitOfWork, AuditProducer } from '@platform';
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
          useValue: { findById: vi.fn(), listForWorkspace: vi.fn(), updatePermissions: vi.fn() },
        },
        {
          provide: ROLE_ASSIGNMENT_REPOSITORY,
          useValue: {
            findById: vi.fn(),
            findExisting: vi.fn(),
            listForUser: vi.fn(),
            listEffectiveForUser: vi.fn(),
            create: vi.fn(),
            delete: vi.fn(),
          },
        },
        { provide: UnitOfWork, useValue: { run: vi.fn((fn: (tx: unknown) => unknown) => fn({})) } },
        { provide: AuditProducer, useValue: { emit: vi.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();

    service = module.get(AccessService);
    roleRepo = module.get(ROLE_REPOSITORY);
    assignmentRepo = module.get(ROLE_ASSIGNMENT_REPOSITORY);
  });

  describe('getUserRoleAndPermissions (JWT baseline)', () => {
    it('falls back to workspace_member view perms when the user has no assignments', async () => {
      assignmentRepo.listEffectiveForUser.mockResolvedValue([]);
      const result = await service.getUserRoleAndPermissions(USER, WORKSPACE);
      expect(result.role).toBe('workspace_member');
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

    it('passes immediately on a JWT wildcard, without a DB lookup', async () => {
      await expect(
        service.assertProjectPermission(actor(['workspace:*']), 'proj-9', 'release:edit'),
      ).resolves.toBeUndefined();
      expect(assignmentRepo.listEffectiveForUser).not.toHaveBeenCalled();
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
    const actor = { sub: USER, workspaceId: WORKSPACE, permissions: [] } as never;
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
});
