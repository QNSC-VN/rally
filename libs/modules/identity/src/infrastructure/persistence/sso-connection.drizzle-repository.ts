import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { InjectDrizzle } from '@platform';
import type { DrizzleDB } from '@platform';
import { ssoConnections } from '../../../../../../db/schema/identity';
import type { SsoConnection, ISsoConnectionRepository } from '@qnsc-vn/identity';

@Injectable()
export class SsoConnectionDrizzleRepository implements ISsoConnectionRepository {
  constructor(@InjectDrizzle() private readonly db: DrizzleDB) {}

  async findByExternalTenantId(
    provider: string,
    externalTenantId: string,
  ): Promise<SsoConnection | null> {
    const rows = await this.db
      .select()
      .from(ssoConnections)
      .where(
        and(
          eq(ssoConnections.provider, provider as 'entra'),
          eq(ssoConnections.externalTenantId, externalTenantId),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }
}
