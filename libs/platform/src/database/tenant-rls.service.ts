import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { InjectDrizzle } from './drizzle.provider';
import type { DrizzleDB, DrizzleTx } from './drizzle.provider';

/**
 * TenantRlsService — wraps Drizzle transactions with a SET LOCAL call that
 * activates the PostgreSQL Row-Level Security policies added in migration 0005.
 *
 * ## Current state (single-tenant MVP)
 * RLS policies exist on all tenant-scoped tables but the Postgres role used by
 * DATABASE_URL is a superuser (bypasses RLS automatically). The application
 * already enforces tenant isolation at the query level via `tenant_id` filters.
 *
 * ## Before tenant #2 goes live
 * 1. Create a non-superuser Postgres role `rally_app` with table privileges.
 * 2. Change DATABASE_URL to connect as `rally_app` (not superuser).
 * 3. Switch all repository methods to use `withTenantContext()` instead of
 *    `this.db.transaction()` directly.
 * 4. RLS will now actively block any query that omits the tenant filter.
 *
 * ## Usage
 * ```ts
 * // In a service:
 * @Inject(TenantRlsService) private readonly rls: TenantRlsService;
 *
 * const result = await this.rls.withTenantContext(tenantId, async (tx) => {
 *   return tx.select().from(users).where(eq(users.id, userId));
 * });
 * ```
 */
@Injectable()
export class TenantRlsService {
  constructor(@InjectDrizzle() private readonly db: DrizzleDB) {}

  /**
   * Execute `fn` inside a Drizzle transaction where `app.tenant_id` is set
   * to `tenantId` via `SET LOCAL` (transaction-scoped, auto-reset on commit/rollback).
   *
   * This is the correct way to activate RLS enforcement for a tenant request.
   */
  async withTenantContext<T>(tenantId: string, fn: (tx: DrizzleTx) => Promise<T>): Promise<T> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_tenant_context(${tenantId}::uuid)`);
      return fn(tx);
    });
  }
}
