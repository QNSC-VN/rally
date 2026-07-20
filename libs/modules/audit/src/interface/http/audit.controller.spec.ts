import 'reflect-metadata';
import { Reflector } from '@nestjs/core';
import { PERMISSION_KEY } from '@platform';
import { describe, expect, it } from 'vitest';
import { AuditController } from './audit.controller';

/**
 * Security regression guard for SRS 4.3 §8 / 4.2 §3.4: the workspace audit log
 * is Workspace-Admin-only and read-only. The FE hiding the tab is not a security
 * control — the API must enforce `workspace:*`. This test fails if the
 * @RequirePermission decorator is ever removed, which would let any authenticated
 * workspace user read the full audit trail.
 */
describe('AuditController authorization metadata', () => {
  it('gates GET /audit-logs behind the workspace-admin permission', () => {
    const reflector = new Reflector();
    const required = reflector.get<string>(PERMISSION_KEY, AuditController.prototype.list);
    expect(required).toBe('workspace:*');
  });
});
