import 'reflect-metadata';
import { Reflector } from '@nestjs/core';
import { POLICY_KEY } from '@modules/access';
import { describe, expect, it } from 'vitest';
import { AuditController } from './audit.controller';

/**
 * Security regression guard for SRS 4.3 §8 / 4.2 §3.4: the workspace audit log
 * is read-only and admin-only. The FE hiding the tab is not a security control —
 * the API must enforce the dedicated `audit:view` code (held only by
 * workspace_admin). This test fails if the @RequirePermission decorator is ever
 * removed, which would let any authenticated workspace user read the full audit
 * trail. (Was `workspace:*`; #183 replaced the wildcard-as-gate with a real code.)
 *
 * Reads `POLICY_KEY`, not the retired `PERMISSION_KEY`: the route moved onto the
 * single `PolicyGuard`, whose metadata is `{ permission, scope? }` rather than a
 * bare code. Asserting `scope` is undefined is part of the contract — a
 * workspace-tier permission must NOT carry one, or the guard would try to resolve
 * a project for it.
 */
describe('AuditController authorization metadata', () => {
  it('gates GET /audit-logs behind the audit:view permission', () => {
    const reflector = new Reflector();
    const policy = reflector.get<{ permission: string; scope?: unknown }>(
      POLICY_KEY,
      AuditController.prototype.list,
    );
    expect(policy?.permission).toBe('audit:view');
    expect(policy?.scope).toBeUndefined();
  });
});
