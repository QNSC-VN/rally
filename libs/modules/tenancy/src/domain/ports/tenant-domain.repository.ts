import type { DbExecutor } from '@platform';
import type { TenantDomain, CreateTenantDomainInput } from '../tenancy.types';

export const TENANT_DOMAIN_REPOSITORY = Symbol('TENANT_DOMAIN_REPOSITORY');

export interface ITenantDomainRepository {
  /** Look up a domain claim by its (globally unique) domain name. */
  findByDomain(domain: string): Promise<TenantDomain | null>;
  create(input: CreateTenantDomainInput, tx?: DbExecutor): Promise<TenantDomain>;
}
