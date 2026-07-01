import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { InjectDrizzle } from '@platform';
import type { DrizzleDB, DbExecutor } from '@platform';
import { tenantDomains } from '../../../../../../db/schema/tenancy';
import type { TenantDomain, CreateTenantDomainInput } from '../../domain/tenancy.types';
import { ITenantDomainRepository } from '../../domain/ports/tenant-domain.repository';

@Injectable()
export class TenantDomainDrizzleRepository implements ITenantDomainRepository {
  constructor(@InjectDrizzle() private readonly db: DrizzleDB) {}

  async findByDomain(domain: string): Promise<TenantDomain | null> {
    const rows = await this.db
      .select()
      .from(tenantDomains)
      .where(eq(tenantDomains.domain, domain.toLowerCase()))
      .limit(1);
    return (rows[0] as TenantDomain | undefined) ?? null;
  }

  async create(input: CreateTenantDomainInput, tx?: DbExecutor): Promise<TenantDomain> {
    const executor = tx ?? this.db;
    const [row] = await executor
      .insert(tenantDomains)
      .values({
        id: input.id,
        tenantId: input.tenantId,
        domain: input.domain.toLowerCase(),
        verified: input.verified ?? null,
        allowAutoJoin: input.allowAutoJoin ?? false,
      })
      .returning();
    return row as TenantDomain;
  }
}
