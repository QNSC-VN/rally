import type { DbExecutor } from '@platform';
import type { TenantMember, TenantMembership, CreateTenantMemberInput } from '../tenancy.types';

export const TENANT_MEMBER_REPOSITORY = Symbol('TENANT_MEMBER_REPOSITORY');

export interface ITenantMemberRepository {
  /**
   * All ACTIVE memberships for a user, ordered most-recently-active first.
   * Joins to tenants to include name + slug for the tenant switcher.
   * No RLS context required — tenant_members has no row-level policy.
   */
  findByUserId(userId: string): Promise<TenantMembership[]>;

  /** Check whether a specific user → tenant membership exists. */
  findByUserAndTenant(userId: string, tenantId: string): Promise<TenantMember | null>;

  /**
   * Insert a keycard row — idempotent (onConflictDoNothing).
   * Safe to call without an RLS context (tenant_members has no RLS).
   */
  create(input: CreateTenantMemberInput, tx?: DbExecutor): Promise<void>;

  /** Stamp last_active_at = now() — drives tenant auto-selection at login. */
  touchLastActive(userId: string, tenantId: string): Promise<void>;
}
