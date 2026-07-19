import { describe, expect, it } from 'vitest'

import {
  describeAuditEvent,
  humanizeToken,
  type AuditEventView,
  type AuditNameResolver,
} from './describe-audit'

const resolver: AuditNameResolver = {
  user: (id) => ({ u1: 'Ada Lovelace', u2: 'Grace Hopper' })[id],
  role: (id) => ({ r1: 'Admin', r2: 'Member' })[id],
  team: (id) => ({ t1: 'Delivery' })[id],
}

function event(partial: Partial<AuditEventView> & { action: string }): AuditEventView {
  return {
    resourceType: 'workspace',
    resourceId: '019f742b-0000-0000-0000-000000000000',
    changes: null,
    ...partial,
  }
}

describe('humanizeToken', () => {
  it('title-cases camelCase, snake_case and dotted tokens', () => {
    expect(humanizeToken('updatedAt')).toBe('Updated At')
    expect(humanizeToken('workspace.settings.updated')).toBe('Workspace Settings Updated')
    expect(humanizeToken('lead_id')).toBe('Lead Id')
  })
})

describe('describeAuditEvent — name resolution', () => {
  it('resolves member add/remove to display names', () => {
    expect(
      describeAuditEvent(
        event({ action: 'workspace.member.added', changes: { after: { userId: 'u1' } } }),
        resolver,
      ),
    ).toBe('Added Ada Lovelace to the workspace')

    expect(
      describeAuditEvent(
        event({ action: 'workspace.member.removed', changes: { before: { userId: 'u2' } } }),
        resolver,
      ),
    ).toBe('Removed Grace Hopper from the workspace')
  })

  it('describes a member role change', () => {
    expect(
      describeAuditEvent(
        event({
          action: 'workspace.member.updated',
          changes: {
            before: { userId: 'u1', roleId: 'r2' },
            after: { userId: 'u1', roleId: 'r1' },
          },
        }),
        resolver,
      ),
    ).toBe('Changed Ada Lovelace’s role from Member to Admin')
  })

  it('describes a member status change', () => {
    expect(
      describeAuditEvent(
        event({
          action: 'workspace.member.updated',
          changes: {
            before: { userId: 'u1', status: 'active' },
            after: { userId: 'u1', status: 'suspended' },
          },
        }),
        resolver,
      ),
    ).toBe('Changed Ada Lovelace’s status from Active to Suspended')
  })

  it('describes an invitation with role', () => {
    expect(
      describeAuditEvent(
        event({
          action: 'workspace.member.invited',
          changes: { after: { email: 'x@y.com', roleId: 'r2' } },
        }),
        resolver,
      ),
    ).toBe('Invited x@y.com as Member')
  })
})

describe('describeAuditEvent — RBAC', () => {
  it('assigns and revokes roles', () => {
    expect(
      describeAuditEvent(
        event({
          action: 'role.assigned',
          resourceType: 'role',
          changes: { after: { userId: 'u1', roleId: 'r1' } },
        }),
        resolver,
      ),
    ).toBe('Assigned the Admin role to Ada Lovelace')
  })

  it('summarises permission changes for the role named by resourceId', () => {
    expect(
      describeAuditEvent(
        event({
          action: 'role.permissions.updated',
          resourceType: 'role',
          resourceId: 'r1',
          changes: {
            before: { permissions: ['a', 'b'] },
            after: { permissions: ['a', 'c', 'd'] },
          },
        }),
        resolver,
      ),
    ).toBe('Updated permissions for the Admin role (+2, −1)')
  })
})

describe('describeAuditEvent — projects & teams', () => {
  it('names created/archived projects', () => {
    expect(
      describeAuditEvent(
        event({
          action: 'project.created',
          resourceType: 'project',
          changes: { after: { name: 'Apollo' } },
        }),
      ),
    ).toBe('Created project Apollo')
    expect(
      describeAuditEvent(
        event({
          action: 'project.archived',
          resourceType: 'project',
          changes: { before: { name: 'Apollo' } },
        }),
      ),
    ).toBe('Archived project Apollo')
  })

  it('renders a project rename as a from/to sentence', () => {
    expect(
      describeAuditEvent(
        event({
          action: 'project.updated',
          resourceType: 'project',
          changes: { before: { name: 'Old' }, after: { name: 'New' } },
        }),
      ),
    ).toBe('Renamed project from “Old” to “New”')
  })

  it('uses a compact #id reference when an entity has no name in the payload', () => {
    expect(
      describeAuditEvent(
        event({
          action: 'project.archived',
          resourceType: 'project',
          resourceId: '0bec7974-0000-0000-0000-000000000000',
          changes: { before: {} },
        }),
      ),
    ).toBe('Archived project #0bec7974')
  })

  it('detects team archival via status', () => {
    expect(
      describeAuditEvent(
        event({
          action: 'team.updated',
          resourceType: 'team',
          changes: {
            before: { name: 'Delivery', status: 'active' },
            after: { name: 'Delivery', status: 'archived' },
          },
        }),
      ),
    ).toBe('Archived team Delivery')
  })

  it('resolves team membership changes', () => {
    expect(
      describeAuditEvent(
        event({
          action: 'team.member.added',
          resourceType: 'team',
          changes: { after: { userId: 'u1', teamId: 't1' } },
        }),
        resolver,
      ),
    ).toBe('Assigned Ada Lovelace to the Delivery team')
  })
})

describe('describeAuditEvent — workspace settings & fallback', () => {
  it('describes a single settings field change', () => {
    expect(
      describeAuditEvent(
        event({
          action: 'workspace.updated',
          changes: { before: { name: 'Acme' }, after: { name: 'Acme Inc' } },
        }),
      ),
    ).toBe('Updated name from “Acme” to “Acme Inc”')
  })

  it('falls back gracefully for unknown/future actions', () => {
    expect(
      describeAuditEvent(
        event({
          action: 'billing.subscription.upgraded',
          resourceType: 'subscription',
          changes: { after: { name: 'Pro' } },
        }),
      ),
    ).toBe('Billing Subscription Upgraded — Pro')
  })

  it('degrades ids without a resolver', () => {
    expect(
      describeAuditEvent(
        event({ action: 'workspace.member.added', changes: { after: { userId: 'abcdef1234' } } }),
      ),
    ).toBe('Added user abcdef12 to the workspace')
  })
})
