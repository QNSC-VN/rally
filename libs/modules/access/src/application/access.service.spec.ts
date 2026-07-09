import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mocked } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { AccessService } from './access.service';
import { ROLE_REPOSITORY, IRoleRepository } from '../domain/ports/role.repository';
import {
  ROLE_ASSIGNMENT_REPOSITORY,
  IRoleAssignmentRepository,
} from '../domain/ports/role-assignment.repository';
import type { SystemRole, UserRoleAssignment, ScopeType } from '../domain/access.types';

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
          useValue: { findById: vi.fn(), listForWorkspace: vi.fn() },
        },
        {
          provide: ROLE_ASSIGNMENT_REPOSITORY,
          useValue: {
            findById: vi.fn(),
            findExisting: vi.fn(),
            listForUser: vi.fn(),
            create: vi.fn(),
            delete: vi.fn(),
          },
        },
      ],
    }).compile();

    service = module.get(AccessService);
    roleRepo = module.get(ROLE_REPOSITORY);
    assignmentRepo = module.get(ROLE_ASSIGNMENT_REPOSITORY);
  });

  describe('getUserRoleAndPermissions (JWT baseline)', () => {
    it('falls back to workspace_member view perms when the user has no assignments', async () => {
      assignmentRepo.listForUser.mockResolvedValue([]);
      const result = await service.getUserRoleAndPermissions(USER, WORKSPACE);
      expect(result.role).toBe('workspace_member');
      expect(result.permissions).toEqual(['workspace:view', 'project:view']);
    });

    it('unions permissions across multiple baseline (workspace + global) roles', async () => {
      const member = role('project_member', ['work_item:edit', 'project:view']);
      const globalRole = role('some_global', ['audit:view', 'project:view']);
      assignmentRepo.listForUser.mockResolvedValue([
        assignment(member.id, 'workspace'),
        assignment(globalRole.id, 'global'),
      ]);
      roleRepo.findById.mockImplementation(async (id) =>
        id === member.id ? member : id === globalRole.id ? globalRole : null,
      );

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
      assignmentRepo.listForUser.mockResolvedValue([
        assignment(workspaceRole.id, 'workspace'),
        assignment(projectRole.id, 'project', 'proj-9'),
      ]);
      roleRepo.findById.mockImplementation(async (id) =>
        id === workspaceRole.id ? workspaceRole : id === projectRole.id ? projectRole : null,
      );

      const result = await service.getUserRoleAndPermissions(USER, WORKSPACE);
      // project-scoped project:edit must NOT leak into the workspace-wide baseline
      expect(result.permissions).toEqual(['work_item:view']);
    });
  });

  describe('getProjectPermissions (per-project resolution)', () => {
    it('unions baseline with the role scoped to the requested project', async () => {
      const workspaceRole = role('project_viewer', ['work_item:view', 'project:view']);
      const projectRole = role('project_admin', ['project:edit', 'project:manage_members']);
      assignmentRepo.listForUser.mockResolvedValue([
        assignment(workspaceRole.id, 'workspace'),
        assignment(projectRole.id, 'project', 'proj-9'),
      ]);
      roleRepo.findById.mockImplementation(async (id) =>
        id === workspaceRole.id ? workspaceRole : id === projectRole.id ? projectRole : null,
      );

      const perms = await service.getProjectPermissions(USER, WORKSPACE, 'proj-9');
      expect(new Set(perms)).toEqual(
        new Set(['work_item:view', 'project:view', 'project:edit', 'project:manage_members']),
      );
    });

    it('does NOT include a role scoped to a different project', async () => {
      const workspaceRole = role('project_viewer', ['work_item:view']);
      const projectRole = role('project_admin', ['project:edit']);
      assignmentRepo.listForUser.mockResolvedValue([
        assignment(workspaceRole.id, 'workspace'),
        assignment(projectRole.id, 'project', 'proj-OTHER'),
      ]);
      roleRepo.findById.mockImplementation(async (id) =>
        id === workspaceRole.id ? workspaceRole : id === projectRole.id ? projectRole : null,
      );

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
        service.assertProjectPermission(actor(['workspace:*']), 'proj-9', 'release:manage'),
      ).resolves.toBeUndefined();
      expect(assignmentRepo.listForUser).not.toHaveBeenCalled();
    });

    it('passes when the project-scoped role grants the permission', async () => {
      const projectRole = role('project_admin', ['release:manage']);
      assignmentRepo.listForUser.mockResolvedValue([
        assignment(projectRole.id, 'project', 'proj-9'),
      ]);
      roleRepo.findById.mockResolvedValue(projectRole);

      await expect(
        service.assertProjectPermission(actor([]), 'proj-9', 'release:manage'),
      ).resolves.toBeUndefined();
    });

    it('throws when neither baseline nor project scope grants it', async () => {
      const otherProjectRole = role('project_admin', ['release:manage']);
      assignmentRepo.listForUser.mockResolvedValue([
        assignment(otherProjectRole.id, 'project', 'proj-OTHER'),
      ]);
      roleRepo.findById.mockResolvedValue(otherProjectRole);

      await expect(
        service.assertProjectPermission(actor([]), 'proj-9', 'release:manage'),
      ).rejects.toMatchObject({ code: 'PROJECT_PERMISSION_DENIED' });
    });
  });
});
