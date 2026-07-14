import { describe, it, expect } from 'vitest';
import { Reflector } from '@nestjs/core';
import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { PermissionGuard } from '@qnsc-vn/identity';
import type { JwtPayload as CoreJwtPayload } from '@qnsc-vn/identity';
import { permissionGrants } from '@shared-kernel';
import { RequirePermission } from './decorators';
import { JwtStrategy } from './jwt.strategy';
import type { AppConfigService } from '../config/app-config.service';

/**
 * Regression guard for the shared-guard consolidation.
 *
 * Rally deleted its local `PermissionGuard` fork and now delegates workspace-tier
 * enforcement to `@qnsc-vn/identity`'s guard, wired with rally's own
 * `permissionGrants` via the `PERMISSION_CHECKER` DI token. That swap is only
 * safe while two invariants hold, both of which are silent-security-gap risks if
 * a future identity bump breaks them:
 *
 *   1. The shared guard reads route metadata under the SAME key that rally's
 *      `@RequirePermission` writes (`'requiredPermission'`). If identity changed
 *      this key, the guard would find no required permission and allow every
 *      request through.
 *   2. The shared guard reads the caller's permissions from `req.user.claims.permissions`.
 *      Rally's `JwtStrategy` must keep mirroring that onto `permissions` for the
 *      rest of the app, and — more importantly here — must keep populating
 *      `claims.permissions` itself.
 *
 * These tests pin both invariants end-to-end using the REAL decorator, the REAL
 * shared guard, and rally's REAL permission catalogue.
 */
describe('workspace-tier PermissionGuard (shared @qnsc-vn/identity guard)', () => {
  class ProtectedController {
    @RequirePermission('project:create')
    create(): void {}

    unprotected(): void {}
  }

  const guard = new PermissionGuard(new Reflector(), permissionGrants);

  const contextFor = (handler: () => void, permissions?: string[]): ExecutionContext =>
    ({
      getHandler: () => handler,
      getClass: () => ProtectedController,
      switchToHttp: () => ({
        getRequest: () => ({
          user: permissions === undefined ? { sub: 'u1' } : { sub: 'u1', claims: { permissions } },
        }),
      }),
    }) as unknown as ExecutionContext;

  const proto = ProtectedController.prototype;

  it("reads rally's @RequirePermission metadata (key parity with identity)", () => {
    // If the metadata keys ever diverge, the guard sees no requirement and this
    // would incorrectly return true for a caller with no matching permission.
    expect(() => guard.canActivate(contextFor(proto.create, ['unrelated:perm']))).toThrow(
      ForbiddenException,
    );
  });

  it('allows an exact permission match', () => {
    expect(guard.canActivate(contextFor(proto.create, ['project:create']))).toBe(true);
  });

  it('allows the workspace:* super-wildcard', () => {
    expect(guard.canActivate(contextFor(proto.create, ['workspace:*']))).toBe(true);
  });

  it('allows a namespace wildcard (project:*)', () => {
    expect(guard.canActivate(contextFor(proto.create, ['project:*']))).toBe(true);
  });

  it('denies when the required permission is absent', () => {
    expect(() => guard.canActivate(contextFor(proto.create, ['work_item:view']))).toThrow(
      ForbiddenException,
    );
  });

  it('denies when the caller carries no permissions', () => {
    expect(() => guard.canActivate(contextFor(proto.create, []))).toThrow(ForbiddenException);
  });

  it('denies when req.user has no claims at all', () => {
    expect(() => guard.canActivate(contextFor(proto.create, undefined))).toThrow(
      ForbiddenException,
    );
  });

  it('allows routes with no @RequirePermission (auth-only)', () => {
    expect(guard.canActivate(contextFor(proto.unprotected, []))).toBe(true);
  });
});

describe('JwtStrategy req.user mirror invariant', () => {
  // The guard reads claims.permissions; the rest of rally reads the flattened
  // mirrors. This pins both so the strategy can't silently stop populating them.
  const config = { get: () => 'x' } as unknown as AppConfigService;
  const strategy = new JwtStrategy(config);

  const basePayload = {
    sub: 'user-1',
    contextId: 'ws-1',
    claims: { permissions: ['project:create', 'work_item:view'] },
  } as unknown as CoreJwtPayload;

  it('mirrors contextId -> workspaceId and claims.permissions -> permissions', () => {
    const user = strategy.validate(basePayload);
    expect(user.workspaceId).toBe('ws-1');
    expect(user.permissions).toEqual(['project:create', 'work_item:view']);
    expect(user.claims).toEqual({ permissions: ['project:create', 'work_item:view'] });
  });

  it('defaults to empty arrays when claims.permissions is missing', () => {
    const user = strategy.validate({ sub: 'u', contextId: 'ws-1', claims: {} } as CoreJwtPayload);
    expect(user.permissions).toEqual([]);
  });
});
