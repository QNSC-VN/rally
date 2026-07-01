import { Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { InjectDrizzle } from '@platform';
import type { DrizzleDB, DbExecutor } from '@platform';
import { tenants, subscriptions } from '../../../../../../db/schema/tenancy';
import type { Tenant, CreateTenantInput } from '../../domain/tenancy.types';
import { ITenantRepository } from '../../domain/ports/tenant.repository';

@Injectable()
export class TenantDrizzleRepository implements ITenantRepository {
  constructor(@InjectDrizzle() private readonly db: DrizzleDB) {}

  async findById(id: string): Promise<Tenant | null> {
    const rows = await this.db.select().from(tenants).where(eq(tenants.id, id)).limit(1);
    return (rows[0] as Tenant | undefined) ?? null;
  }

  async findBySlug(slug: string): Promise<Tenant | null> {
    const rows = await this.db
      .select()
      .from(tenants)
      .where(and(eq(tenants.slug, slug), isNull(tenants.deletedAt)))
      .limit(1);
    return (rows[0] as Tenant | undefined) ?? null;
  }

  async create(input: CreateTenantInput, tx?: DbExecutor): Promise<Tenant> {
    const executor = tx ?? this.db;
    const [row] = await executor
      .insert(tenants)
      .values({ id: input.id, slug: input.slug, name: input.name })
      .returning();
    return row as Tenant;
  }

  async createSubscription(
    tenantId: string,
    plan: 'free' | 'starter' | 'pro' | 'enterprise',
    status: 'active' | 'trialing' | 'past_due' | 'canceled',
    tx?: DbExecutor,
  ): Promise<void> {
    const executor = tx ?? this.db;
    await executor.insert(subscriptions).values({ tenantId, plan, status }).onConflictDoNothing();
  }
}
