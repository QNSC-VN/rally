import { describe, expect, it } from 'vitest'

import type { ApiToken } from './api'
import { EXPIRING_SOON_DAYS, daysUntilExpiry, isRevocable, tokenState } from './token-state'

/**
 * The API returns `expiresAt` and `revokedAt` and no status field, which is right — a stored status
 * is a second source of truth that a clock invalidates. So the derivation is one pure function, and
 * this is where it is pinned: every surface showing a token asks it the same question.
 */
const NOW = new Date('2026-06-01T12:00:00.000Z')

function token(overrides: Partial<ApiToken> = {}): ApiToken {
  return {
    id: 't-1',
    name: 'CI pipeline',
    prefix: 'rly_abc12345',
    scopes: null,
    expiresAt: '2026-12-01T12:00:00.000Z',
    lastUsedAt: null,
    revokedAt: null,
    createdAt: '2026-05-01T12:00:00.000Z',
    userId: 'u-1',
    ...overrides,
  }
}

describe('tokenState', () => {
  it('is active while expiry is far away', () => {
    expect(tokenState(token(), NOW)).toBe('active')
  })

  it('is expiring inside the notice window', () => {
    const soon = new Date(NOW.getTime() + (EXPIRING_SOON_DAYS - 1) * 86_400_000)
    expect(tokenState(token({ expiresAt: soon.toISOString() }), NOW)).toBe('expiring')
  })

  it('is expired once the moment has passed', () => {
    expect(tokenState(token({ expiresAt: '2026-05-31T12:00:00.000Z' }), NOW)).toBe('expired')
  })

  it('treats the boundary as expired rather than nearly fine', () => {
    // Equal timestamps mean the token is done. Reporting `expiring` here would show a green-ish
    // badge on a credential that has already stopped working.
    expect(tokenState(token({ expiresAt: NOW.toISOString() }), NOW)).toBe('expired')
  })

  it('reports revoked ahead of any expiry reading', () => {
    // A revoked token that has not yet expired is still revoked: the resolver refuses it on the next
    // request, so an `active` badge would describe a credential that cannot be used.
    const revoked = token({ revokedAt: '2026-05-20T12:00:00.000Z' })
    expect(tokenState(revoked, NOW)).toBe('revoked')
  })

  it('reads an unparseable expiry as expired, not as fine', () => {
    // Fails towards "look at this". Defaulting to `active` would hide a token nobody can reason
    // about behind the badge that means "nothing to do here".
    expect(tokenState(token({ expiresAt: 'not-a-date' }), NOW)).toBe('expired')
  })
})

describe('daysUntilExpiry', () => {
  it('floors to whole days so the copy never rounds up', () => {
    const in90 = new Date(NOW.getTime() + 90 * 86_400_000 + 3_600_000)
    expect(daysUntilExpiry(token({ expiresAt: in90.toISOString() }), NOW)).toBe(90)
  })

  it('goes negative once past, so a caller can tell the difference', () => {
    expect(daysUntilExpiry(token({ expiresAt: '2026-05-30T12:00:00.000Z' }), NOW)).toBe(-2)
  })
})

describe('isRevocable', () => {
  it('is true only while the token could still be used', () => {
    expect(isRevocable(token(), NOW)).toBe(true)
    expect(isRevocable(token({ revokedAt: '2026-05-20T12:00:00.000Z' }), NOW)).toBe(false)
    expect(isRevocable(token({ expiresAt: '2026-05-01T12:00:00.000Z' }), NOW)).toBe(false)
  })
})
