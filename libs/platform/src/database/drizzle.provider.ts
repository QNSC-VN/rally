import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { Inject, Injectable } from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service';
import * as schema from '../../../../db/schema';

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

  private static buildPgOptions(url: string): { connectionString: string; ssl?: { rejectUnauthorized: false } } {
    const needsSsl = /sslmode=(require|verify)/.test(url);
    if (!needsSsl) return { connectionString: url };
    try {
      const u = new URL(url);
      u.searchParams.delete('sslmode');
      return { connectionString: u.toString(), ssl: { rejectUnauthorized: false } };
    } catch {
      return { connectionString: url, ssl: { rejectUnauthorized: false } };
    }
  }

  constructor(private readonly config: AppConfigService) {
    const dbUrl = config.get('DATABASE_URL');
    // pg-connection-string maps sslmode=require to ssl.rejectUnauthorized=true (verify-full in v8+).
    // Alpine lacks the Amazon RDS CA, so strip sslmode and set ssl explicitly to avoid
    // conflicting config. Safe for VPC-internal private-subnet connections.
    const pgOpts = DrizzleProvider.buildPgOptions(dbUrl);

    this.pool = new Pool({
      ...pgOpts,
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
