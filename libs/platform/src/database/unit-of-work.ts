import { Injectable } from '@nestjs/common';
import { InjectDrizzle } from './drizzle.provider';
import type { DrizzleDB, DrizzleTx } from './drizzle.provider';

export const UNIT_OF_WORK = Symbol('UNIT_OF_WORK');

export interface IUnitOfWork {
  run<T>(work: (tx: DrizzleTx) => Promise<T>): Promise<T>;
}

/**
 * Unit of Work — wraps every command in one Postgres transaction.
 *
 * Steps inside the tx (atomic):
 *   1. All domain writes (repository.save)
 *   2. All outbox inserts (same tx = no dual-write)
 *   3. COMMIT — or ROLLBACK on any error
 *
 * Workspace isolation is enforced at the application layer (workspace_id
 * filters on every query); there is no DB-level RLS.
 */
@Injectable()
export class UnitOfWork implements IUnitOfWork {
  constructor(@InjectDrizzle() private readonly db: DrizzleDB) {}

  async run<T>(work: (tx: DrizzleTx) => Promise<T>): Promise<T> {
    return this.db.transaction(async (tx) => work(tx));
  }
}
