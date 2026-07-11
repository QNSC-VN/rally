import { Injectable } from '@nestjs/common';
import type { ITransactionRunner } from '@qnsc-vn/identity';
import { InjectDrizzle } from '@platform';
import type { DrizzleDB, DbExecutor } from '@platform';

/**
 * Rally's {@link ITransactionRunner}. Adapts the shared auth core's
 * ORM-agnostic transaction port onto drizzle's `db.transaction`, threading the
 * drizzle executor through to the repository ports so multi-step auth writes
 * (rotate refresh token + stamp last-login) stay atomic.
 */
@Injectable()
export class DrizzleTransactionRunner implements ITransactionRunner<DbExecutor> {
  constructor(@InjectDrizzle() private readonly db: DrizzleDB) {}

  transaction<T>(fn: (tx: DbExecutor) => Promise<T>): Promise<T> {
    return this.db.transaction((tx) => fn(tx));
  }
}
