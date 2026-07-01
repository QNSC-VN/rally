import { Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { InjectDrizzle } from './drizzle.provider';
import type { DrizzleDB, DrizzleTx } from './drizzle.provider';
import { RequestContextService } from '../context/request-context';

export const UNIT_OF_WORK = Symbol('UNIT_OF_WORK');

export interface IUnitOfWork {
  run<T>(work: (tx: DrizzleTx) => Promise<T>): Promise<T>;
}

/**
 * Unit of Work — wraps every command in one Postgres transaction.
 *
 * Steps inside the tx (atomic):
 *   1. SET LOCAL app.tenant_id  → RLS policies activate, fail-closed
 *   2. All domain writes (repository.save)
 *   3. All outbox inserts (same tx = no dual-write)
 *   4. COMMIT — or ROLLBACK on any error
 *
 * No tenantId in context → hard reject (fail-closed, not fail-open).
 */
@Injectable()
export class UnitOfWork implements IUnitOfWork {
  private readonly logger = new Logger(UnitOfWork.name);

  constructor(
    @InjectDrizzle() private readonly db: DrizzleDB,
    private readonly ctx: RequestContextService,
  ) {}

  async run<T>(work: (tx: DrizzleTx) => Promise<T>): Promise<T> {
    const tenantId = this.ctx.getTenantId();

    if (!tenantId) {
      this.logger.error('UnitOfWork.run called without tenant context — rejecting');
      throw new Error('Missing tenant context: cannot open transaction without app.tenant_id');
    }

    return this.db.transaction(async (tx) => {
      // SET LOCAL — scoped to this transaction only
      await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`);
      return work(tx);
    });
  }
}
