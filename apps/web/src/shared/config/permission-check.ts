import { PERMISSION } from './permissions'

/**
 * The single frontend implementation of the wildcard-aware permission-gating
 * rule. It MUST mirror the backend `permissionGrants` (db/permissions.catalog.ts,
 * surfaced as @shared-kernel) — a backend contract spec asserts this parity so
 * the two can't silently drift.
 *
 *  - `workspace:*` grants everything
 *  - an exact code match grants that code
 *  - a namespace wildcard `ns:*` grants every code in that namespace
 *
 * This module is intentionally dependency-free (no React, no network) so it is
 * safe to import from the auth store, hooks, and Node-side contract tests alike.
 */
export function grants(permissions: readonly string[], code: string): boolean {
  if (!permissions.length) return false
  if (permissions.includes(PERMISSION.WORKSPACE_ALL) || permissions.includes(code)) return true
  const ns = code.split(':')[0]
  return !!ns && permissions.includes(`${ns}:*`)
}
