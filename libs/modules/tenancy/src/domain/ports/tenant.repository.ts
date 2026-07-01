import type { Tenant, CreateTenantInput } from '../tenancy.types';
import type { DbExecutor } from '@platform';

export const TENANT_REPOSITORY = Symbol('TENANT_REPOSITORY');

export interface ITenantRepository {
  findById(id: string): Promise<Tenant | null>;
  findBySlug(slug: string): Promise<Tenant | null>;
  create(input: CreateTenantInput, tx?: DbExecutor): Promise<Tenant>;
  createSubscription(
    tenantId: string,
    plan: 'free' | 'starter' | 'pro' | 'enterprise',
    status: 'active' | 'trialing' | 'past_due' | 'canceled',
    tx?: DbExecutor,
  ): Promise<void>;
}
