import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mocked } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { UnitOfWork, AuditProducer, DRIZZLE, PreconditionFailedException } from '@platform';
import { CacheService } from '@qnsc-vn/platform-cache';
import { AccessService } from './access.service';
import { ROLE_REPOSITORY, IRoleRepository } from '../domain/ports/role.repository';
import {
  ROLE_ASSIGNMENT_REPOSITORY,
  IRoleAssignmentRepository,
} from '../domain/ports/role-assignment.repository';
import { PROJECT_ACCESS_REPOSITORY } from '../domain/ports/project-access.repository';
import type {
  SystemRole,
  UserRoleAssignment,
  ScopeType,
  EffectiveAssignment,
} from '../domain/access.types';

// ── Fixtures ─────────────────────────────────────────────────────────────────

/**
 * The per-Project grant reads and writes. Every method takes an optional executor because
 * `grantProjectAccess` has to be joinable to a transaction its caller already opened — see the
 * port's docblock. Defaults describe the ordinary case: a live project, an active workspace member,
 * no Workspace Admins, no existing grant.
 */
/** The tx `UnitOfWork.run` hands the work, exposed so a test can prove the writes enlisted on it. */
const makeUow = () => {
  const tx = { __tx: 'uow' };
  return { run: vi.fn((fn: (tx: unknown) => unknown) => fn(tx)), tx };
};

const makeProjectAccessRepo = () => ({
  findLiveProject: vi.fn().mockResolvedValue({ id: 'proj-1' }),
  isActiveWorkspaceMember: vi.fn().mockResolvedValue(true),
  listWorkspaceAdminUserIds: vi.fn().mockResolvedValue([]),
  findGrant: vi.fn().mockResolvedValue(null),
  createGrant: vi
    .fn()
    .mockImplementation((input: { id: string; accessLevel?: string }) =>
      Promise.resolve({ id: input.id, accessLevel: input.accessLevel ?? null }),
    ),
  setGrantLevel: vi
    .fn()
    .mockImplementation((id: string, accessLevel: string) => Promise.resolve({ id, accessLevel })),
});

let projectMemberRows: Array<{ projectId: string }> = [];
// Phase 3: effectiveAssignments reads per-Project access_level rows directly.
let accessLevelRows: Array<{ projectId: string; accessLevel: string | null }> = [];

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
  let projectAccessRepo: ReturnType<typeof makeProjectAccessRepo>;
  let uow: ReturnType<typeof makeUow>;
  let audit: { emit: ReturnType<typeof vi.fn> };
  let cache: Mocked<CacheService>;

  beforeEach(async () => {
    projectAccessRepo = makeProjectAccessRepo();
    uow = makeUow();
    audit = { emit: vi.fn().mockResolvedValue(undefined) };
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
        { provide: PROJECT_ACCESS_REPOSITORY, useValue: projectAccessRepo },
        { provide: UnitOfWork, useValue: uow },
        { provide: AuditProducer, useValue: audit },
        {
          // `listReadableProjectIds` reads project_members directly (no port exists for
          // the roster). Chainable stub; `projectMemberRows` is what each test controls.
          provide: DRIZZLE,
          useValue: {
            select: () => ({
              from: () => ({
                // effectiveAssignments access_level query (now 1 join) and
                // listReadableProjectIds (2 joins) — chainable; tests control
                // `accessLevelRows` / `projectMemberRows`.
                where: () => Promise.resolve(accessLevelRows),
                innerJoin: () => ({
                  where: () => Promise.resolve(accessLevelRows),
                  innerJoin: () => ({
                    where: () => Promise.resolve(projectMemberRows),
                  }),
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
    // Default: the acting user is a workspace admin. Escalation checks now resolve
    // the ACTOR's own permissions from the database instead of reading the token,
    // so tests that exercise a write need a resolvable actor; the no-escalation
    // cases narrow this deliberately.
    projectMemberRows = [];
    accessLevelRows = [];
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
    it('grants NO workspace-tier permission when the user has no assignments', async () => {
      assignmentRepo.listEffectiveForUser.mockResolvedValue([]);
      const result = await service.getUserRoleAndPermissions(USER, WORKSPACE);
      // No workspace/global assignment means no workspace-tier permission at all. This
      // returned `['workspace:view']` as a "minimal shell baseline" until migration 0111
      // deleted the workspace-scoped tier assignments and put every normal user in this
      // branch — at which point the floor handed the whole company a code that gates
      // Workspace Settings and the SCM inventory. Delivery access is per-Project, and
      // `getProjectPermissions` unions this baseline, so an empty one takes nothing away.
      expect(result.role).toBe('');
      expect(result.permissions).toEqual([]);
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

  /**
   * The ONE per-Project grant writer. §5's closing sentence (AC-9) is that all three journeys —
   * Users & Permissions, an invitation's initial access (§6.4) and team setup (P4-RBAC-010) —
   * update the same source, and they can only do that if there is one writer to reach.
   *
   * These tests came from `projects.service.spec.ts` with the body they cover. They had to move:
   * `ProjectsService.addProjectMember` is a thin delegate now and `AccessService` is a mock over
   * there, so an assertion on the repository would be asserting on nothing.
   */
  describe('grantProjectAccess — the one per-Project grant writer', () => {
    const grant = (o: Record<string, unknown> = {}) => ({
      workspaceId: WORKSPACE,
      projectId: 'proj-1',
      userId: 'user-2',
      actorId: 'admin-1',
      onWorkspaceAdmin: 'refuse' as const,
      ...o,
    });

    it('grants a user who is an active workspace member', async () => {
      await service.grantProjectAccess(grant());
      expect(projectAccessRepo.createGrant).toHaveBeenCalled();
    });

    it('404s an unknown or soft-deleted project before any check that could leak it exists', async () => {
      projectAccessRepo.findLiveProject.mockResolvedValue(null);
      await expect(service.grantProjectAccess(grant())).rejects.toMatchObject({
        code: 'PROJECT_NOT_FOUND',
      });
      expect(projectAccessRepo.createGrant).not.toHaveBeenCalled();
    });

    it('rejects a user who is not an active workspace member', async () => {
      // The rule that stops a user from another workspace/tenant becoming a project member.
      projectAccessRepo.isActiveWorkspaceMember.mockResolvedValue(false);
      await expect(service.grantProjectAccess(grant({ userId: 'foreign-user' }))).rejects.toThrow(
        PreconditionFailedException,
      );
      expect(projectAccessRepo.createGrant).not.toHaveBeenCalled();
    });

    it('persists the chosen access level up front (Add Existing User flow)', async () => {
      await service.grantProjectAccess(grant({ accessLevel: 'editor' }));
      expect(projectAccessRepo.createGrant).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-2', accessLevel: 'editor' }),
        uow.tx,
      );
    });

    it('omits accessLevel when none is supplied (lands NULL until a PATCH)', async () => {
      await service.grantProjectAccess(grant());
      expect(projectAccessRepo.createGrant).toHaveBeenCalledWith(
        expect.not.objectContaining({ accessLevel: expect.anything() }),
        uow.tx,
      );
    });

    it('upserts: an existing NULL-level row gets the level instead of a 409', async () => {
      // The team-derived / pre-fix shape: an explicit row with no level. Refusing the POST meant
      // the UI could show the user in the project yet be unable to give them a level.
      projectAccessRepo.findGrant.mockResolvedValue({
        id: 'pm-existing',
        userId: 'user-2',
        accessLevel: null,
      });

      const result = await service.grantProjectAccess(grant({ accessLevel: 'editor' }));

      expect(projectAccessRepo.setGrantLevel).toHaveBeenCalledWith('pm-existing', 'editor', uow.tx);
      expect(result.accessLevel).toBe('editor');
      expect(audit.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'project.member.updated',
          changes: {
            before: { userId: 'user-2', accessLevel: null },
            after: { userId: 'user-2', accessLevel: 'editor' },
          },
        }),
        uow.tx,
      );
    });

    it('is idempotent when the level already matches — no write, no audit row', async () => {
      const existing = { id: 'pm-existing', userId: 'user-2', accessLevel: 'editor' };
      projectAccessRepo.findGrant.mockResolvedValue(existing);

      await expect(service.grantProjectAccess(grant({ accessLevel: 'editor' }))).resolves.toBe(
        existing,
      );
      expect(projectAccessRepo.setGrantLevel).not.toHaveBeenCalled();
      expect(audit.emit).not.toHaveBeenCalled();
    });

    it('emits project.member.added in the SAME tx as the write', async () => {
      // Same tx as the mutation: the outbox row can never diverge from the grant it records.
      await service.grantProjectAccess(grant({ accessLevel: 'admin' }));
      expect(audit.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'project.member.added',
          projectId: 'proj-1',
          changes: { after: { userId: 'user-2', accessLevel: 'admin' } },
        }),
        uow.tx,
      );
    });

    it('invalidates the cached permissions AFTER the transaction it owns', async () => {
      await service.grantProjectAccess(grant({ accessLevel: 'editor' }));
      expect(cache.del).toHaveBeenCalledWith(`authz:assign:${WORKSPACE}:user-2`);
    });

    /**
     * RBE-03. AC-8 / §2.1: "a Workspace Admin is not added as a Project user or Team member."
     * `listProjectMembers` HIDES these rows, so a row created here would be an invisible grant —
     * live Project Admin the moment the user stops being a Workspace Admin.
     */
    describe('a Workspace Admin is not a project user (§2.1)', () => {
      beforeEach(() => {
        projectAccessRepo.listWorkspaceAdminUserIds.mockResolvedValue(['wa-1']);
      });

      it('REFUSES the grant when the caller asked for one directly', async () => {
        await expect(
          service.grantProjectAccess(grant({ userId: 'wa-1', accessLevel: 'editor' })),
        ).rejects.toMatchObject({ code: 'PROJECT_MEMBER_IS_WORKSPACE_ADMIN' });
        expect(projectAccessRepo.createGrant).not.toHaveBeenCalled();
      });

      it('SKIPS the grant when it is a side effect of another action', async () => {
        // Accepting an invitation or joining a team must not become unredeemable/uncreatable
        // because the user already has every project by workspace grant.
        await expect(
          service.grantProjectAccess(
            grant({ userId: 'wa-1', accessLevel: 'editor', onWorkspaceAdmin: 'skip' }),
          ),
        ).resolves.toBeNull();
        expect(projectAccessRepo.createGrant).not.toHaveBeenCalled();
      });
    });

    /**
     * The reason this method takes a `tx` at all. `WorkspaceService.acceptInvitation` writes the
     * user's `workspace_members` row and grants project access in ONE transaction — and
     * `UnitOfWork.run` is `db.transaction`, which does not nest. A membership check that read the
     * pool instead of the caller's tx could not see the uncommitted row and would refuse the grant
     * with `ASSIGNEE_NOT_WORKSPACE_MEMBER`; skipping the check instead is what would let a user
     * from another workspace/tenant in.
     */
    describe('joining a caller’s transaction', () => {
      const callerTx = { __tx: 'caller' } as never;

      it('threads the caller’s tx through every CHECK, not just the writes', async () => {
        await service.grantProjectAccess(grant({ accessLevel: 'editor' }), callerTx);

        expect(projectAccessRepo.findLiveProject).toHaveBeenCalledWith(
          WORKSPACE,
          'proj-1',
          callerTx,
        );
        expect(projectAccessRepo.isActiveWorkspaceMember).toHaveBeenCalledWith(
          WORKSPACE,
          'user-2',
          callerTx,
        );
        expect(projectAccessRepo.listWorkspaceAdminUserIds).toHaveBeenCalledWith(
          WORKSPACE,
          callerTx,
        );
        expect(projectAccessRepo.findGrant).toHaveBeenCalledWith('proj-1', 'user-2', callerTx);
        expect(projectAccessRepo.createGrant).toHaveBeenCalledWith(expect.anything(), callerTx);
      });

      it('does not open its own transaction', async () => {
        await service.grantProjectAccess(grant({ accessLevel: 'editor' }), callerTx);
        expect(uow.run).not.toHaveBeenCalled();
      });

      it('leaves cache invalidation to the caller, who knows when the tx commits', async () => {
        // Invalidating before commit lets a concurrent request repopulate from pre-commit state —
        // the exact staleness the cache exists to remove.
        await service.grantProjectAccess(grant({ accessLevel: 'editor' }), callerTx);
        expect(cache.del).not.toHaveBeenCalled();
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
  let projectAccessRepo: ReturnType<typeof makeProjectAccessRepo>;
  let uow: ReturnType<typeof makeUow>;

  const actor = {
    sub: 'admin-1',
    workspaceId: WORKSPACE,
    permissions: ['workspace:*'],
  } as unknown as Parameters<AccessService['assignRole']>[0];

  beforeEach(async () => {
    projectAccessRepo = makeProjectAccessRepo();
    uow = makeUow();
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
        { provide: PROJECT_ACCESS_REPOSITORY, useValue: projectAccessRepo },
        { provide: UnitOfWork, useValue: uow },
        { provide: AuditProducer, useValue: { emit: vi.fn().mockResolvedValue(undefined) } },
        {
          // `listReadableProjectIds` reads project_members directly (no port exists for
          // the roster). Chainable stub; `projectMemberRows` is what each test controls.
          provide: DRIZZLE,
          useValue: {
            select: () => ({
              from: () => ({
                // effectiveAssignments access_level query (now 1 join) and
                // listReadableProjectIds (2 joins) — chainable; tests control
                // `accessLevelRows` / `projectMemberRows`.
                where: () => Promise.resolve(accessLevelRows),
                innerJoin: () => ({
                  where: () => Promise.resolve(accessLevelRows),
                  innerJoin: () => ({
                    where: () => Promise.resolve(projectMemberRows),
                  }),
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

  it('REFUSES a project-scoped assignment (scope retired with the access-level model)', async () => {
    // Migration 0105 deleted scope_type='project' rows but the writer stayed, and a
    // row minted here grants project-tier perms OUTSIDE project_members.access_level
    // while getProjectAccessLevel doesn't recognize roleSlug 'project_member' — so
    // assertTeamScoped silently bypasses for an "editor" granted this way. Refused
    // loudly instead. (The old test asserted invalidation fired for the minted row;
    // the row must not exist to invalidate.)
    const target = role('project_admin', ['project:edit']);
    roleRepo.findById.mockResolvedValue(target);

    await expect(service.assignRole(actor, USER, target.id, 'project', 'proj-9')).rejects.toThrow(
      'Project-scoped role assignments were retired',
    );
    expect(assignmentRepo.create).not.toHaveBeenCalled();
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
