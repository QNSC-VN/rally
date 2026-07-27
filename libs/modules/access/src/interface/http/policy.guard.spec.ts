import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { PermissionDeniedException, type JwtPayload } from '@platform';
import { PolicyGuard, type PolicyScope } from './policy.guard';
import type { AccessService } from '../../application/access.service';
import type { ProjectScopeResolver } from '../../application/project-scope.resolver';

// Real permission codes so isProjectTierPermission / permissionGrants run for real:
//   roles:view   → WORKSPACE tier
//   work_item:edit → PROJECT tier
const WS_CODE = 'roles:view';
const PROJ_CODE = 'work_item:edit';

const actor = (permissions: string[]): JwtPayload => ({
  sub: 'user-1',
  workspaceId: 'ws-1',
  contextId: 'ws-1',
  permissions,
  claims: { permissions },
  sessionId: 's1',
  jti: 'j1',
  iss: 'rally',
  aud: 'rally',
  iat: 0,
  exp: 0,
  authMethod: 'sso',
});

function makeCtx(
  meta: { permission: string; scope?: PolicyScope } | undefined,
  req: {
    user?: JwtPayload;
    params?: Record<string, string>;
    query?: Record<string, unknown>;
    body?: Record<string, unknown>;
  },
): { ctx: ExecutionContext; reflector: Reflector } {
  const reflector = {
    getAllAndOverride: vi.fn().mockReturnValue(meta),
  } as unknown as Reflector;
  const ctx = {
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({
      getRequest: () => ({ params: {}, query: {}, body: {}, ...req }),
    }),
  } as unknown as ExecutionContext;
  return { ctx, reflector };
}

describe('PolicyGuard', () => {
  let access: { getProjectPermissions: ReturnType<typeof vi.fn> };
  let resolver: { resolve: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    access = { getProjectPermissions: vi.fn() };
    resolver = { resolve: vi.fn() };
  });

  const guardFor = (reflector: Reflector) =>
    new PolicyGuard(
      reflector,
      access as unknown as AccessService,
      resolver as unknown as ProjectScopeResolver,
    );

  it('allows a route with no policy metadata (authenticated-only)', async () => {
    const { ctx, reflector } = makeCtx(undefined, { user: actor([]) });
    await expect(guardFor(reflector).canActivate(ctx)).resolves.toBe(true);
  });

  it('fails closed when the user is missing (JwtAuthGuard did not run)', async () => {
    const { ctx, reflector } = makeCtx({ permission: WS_CODE }, { user: undefined });
    await expect(guardFor(reflector).canActivate(ctx)).rejects.toBeInstanceOf(
      PermissionDeniedException,
    );
  });

  // ── Workspace tier ────────────────────────────────────────────────────────
  describe('workspace-tier', () => {
    it('allows when the flat JWT baseline grants the code', async () => {
      const { ctx, reflector } = makeCtx({ permission: WS_CODE }, { user: actor([WS_CODE]) });
      await expect(guardFor(reflector).canActivate(ctx)).resolves.toBe(true);
      expect(access.getProjectPermissions).not.toHaveBeenCalled();
    });

    it('denies when the baseline lacks the code — never touches project resolution', async () => {
      const { ctx, reflector } = makeCtx({ permission: WS_CODE }, { user: actor(['audit:view']) });
      await expect(guardFor(reflector).canActivate(ctx)).rejects.toBeInstanceOf(
        PermissionDeniedException,
      );
      expect(resolver.resolve).not.toHaveBeenCalled();
    });

    it('honours a workspace wildcard', async () => {
      const { ctx, reflector } = makeCtx({ permission: WS_CODE }, { user: actor(['workspace:*']) });
      await expect(guardFor(reflector).canActivate(ctx)).resolves.toBe(true);
    });
  });

  // ── Project tier ──────────────────────────────────────────────────────────
  describe('project-tier', () => {
    const scope: PolicyScope = { resource: 'work_item', from: 'param', field: 'id' };

    it('fast-paths a workspace-wide grant without resolving the project', async () => {
      const { ctx, reflector } = makeCtx(
        { permission: PROJ_CODE, scope },
        { user: actor(['workspace:*']), params: { id: 'wi-1' } },
      );
      await expect(guardFor(reflector).canActivate(ctx)).resolves.toBe(true);
      expect(resolver.resolve).not.toHaveBeenCalled();
      expect(access.getProjectPermissions).not.toHaveBeenCalled();
    });

    it('resolves the project from the resource and allows when the project role grants it', async () => {
      resolver.resolve.mockResolvedValue('proj-9');
      access.getProjectPermissions.mockResolvedValue([PROJ_CODE]);
      const { ctx, reflector } = makeCtx(
        { permission: PROJ_CODE, scope },
        { user: actor(['work_item:view']), params: { id: 'wi-1' } },
      );
      await expect(guardFor(reflector).canActivate(ctx)).resolves.toBe(true);
      expect(resolver.resolve).toHaveBeenCalledWith('work_item', 'wi-1', 'ws-1');
      expect(access.getProjectPermissions).toHaveBeenCalledWith('user-1', 'ws-1', 'proj-9');
    });

    it('denies when the resolved project role lacks the code', async () => {
      resolver.resolve.mockResolvedValue('proj-9');
      access.getProjectPermissions.mockResolvedValue(['work_item:view']);
      const { ctx, reflector } = makeCtx(
        { permission: PROJ_CODE, scope },
        { user: actor(['work_item:view']), params: { id: 'wi-1' } },
      );
      await expect(guardFor(reflector).canActivate(ctx)).rejects.toBeInstanceOf(
        PermissionDeniedException,
      );
    });

    it('uses the id directly as the projectId for a non-resource scope', async () => {
      access.getProjectPermissions.mockResolvedValue([PROJ_CODE]);
      const { ctx, reflector } = makeCtx(
        { permission: PROJ_CODE, scope: { from: 'query', field: 'projectId' } },
        { user: actor([]), query: { projectId: 'proj-42' } },
      );
      await expect(guardFor(reflector).canActivate(ctx)).resolves.toBe(true);
      expect(resolver.resolve).not.toHaveBeenCalled();
      expect(access.getProjectPermissions).toHaveBeenCalledWith('user-1', 'ws-1', 'proj-42');
    });

    it('denies when the scope id is absent from the request', async () => {
      const { ctx, reflector } = makeCtx(
        { permission: PROJ_CODE, scope: { from: 'query', field: 'projectId' } },
        { user: actor([]), query: {} },
      );
      await expect(guardFor(reflector).canActivate(ctx)).rejects.toBeInstanceOf(
        PermissionDeniedException,
      );
      expect(access.getProjectPermissions).not.toHaveBeenCalled();
    });

    it('propagates a resolver 404 (unknown resource) instead of masking it as a deny', async () => {
      resolver.resolve.mockRejectedValue(new Error('WORK_ITEM_NOT_FOUND'));
      const { ctx, reflector } = makeCtx(
        { permission: PROJ_CODE, scope },
        { user: actor([]), params: { id: 'missing' } },
      );
      await expect(guardFor(reflector).canActivate(ctx)).rejects.toThrow('WORK_ITEM_NOT_FOUND');
    });
  });
});
