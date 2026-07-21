import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { Inject, Injectable } from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service';
import * as schema from '../../../../db/schema';
import { pgOptions } from '../../../../db/pg-ssl';
import { resolveDatabaseUrl } from '../../../../db/database-url';

export const DRIZZLE = Symbol('DRIZZLE');

export type DrizzleDB = ReturnType<typeof drizzle<typeof schema>>;
export type DrizzleTx = Parameters<Parameters<DrizzleDB['transaction']>[0]>[0];

/**
 * A database executor — either the root connection or an open transaction.
 *
 * Repository methods accept an optional `DbExecutor` so they can enlist in a
 * caller-owned transaction (Unit of Work).  When omitted they fall back to the
 * injected root `DrizzleDB`, preserving the simple single-statement path.
 */
export type DbExecutor = DrizzleDB | DrizzleTx;

export const InjectDrizzle = () => Inject(DRIZZLE);

@Injectable()
export class DrizzleProvider {
  private pool: Pool;
  private db: DrizzleDB;

  constructor(private readonly config: AppConfigService) {
    this.pool = new Pool({
      // Composed from DATABASE_* parts when no complete URL is supplied, so the
      // deployed path reads the RDS-managed secret directly and never holds a
      // copy of a rotating password. See db/database-url.ts.
      ...pgOptions(
        resolveDatabaseUrl({
          DATABASE_URL: config.get('DATABASE_URL'),
          DATABASE_HOST: config.get('DATABASE_HOST'),
          DATABASE_PORT: config.get('DATABASE_PORT'),
          DATABASE_NAME: config.get('DATABASE_NAME'),
          DATABASE_USER: config.get('DATABASE_USER'),
          DATABASE_PASSWORD: config.get('DATABASE_PASSWORD'),
          DATABASE_SSLMODE: config.get('DATABASE_SSLMODE'),
        }),
      ),
      min: config.get('DATABASE_POOL_MIN'),
      max: config.get('DATABASE_POOL_MAX'),
      // Fail fast on idle connections to surface misconfiguration
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });

    this.db = drizzle(this.pool, { schema, logger: config.get('LOG_SQL') });
  }

  get instance(): DrizzleDB {
    return this.db;
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
