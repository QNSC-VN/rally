/**
 * Local dev helper: TRUNCATE every data table (all schemas) except the drizzle
 * migration bookkeeping, so `db:migrate` stays a no-op and `db:seed` runs onto
 * an empty database. Guards against non-local hosts.
 */
try {
  process.loadEnvFile('.env');
} catch {
  /* CI mode */
}

import { Pool } from 'pg';
import { resolveMigrationUrl } from './database-url';
import { pgOptions } from './pg-ssl';

const url = resolveMigrationUrl();
const host = new URL(url).hostname;
if (!['localhost', '127.0.0.1'].includes(host)) {
  console.error(`❌  Refusing to truncate non-local host: ${host}`);
  process.exit(1);
}

const pool = new Pool({ ...pgOptions(url), max: 1 });

async function run() {
  const { rows } = await pool.query<{ fq: string }>(`
    select format('%I.%I', schemaname, tablename) as fq
    from pg_tables
    where schemaname not in ('pg_catalog', 'information_schema', 'drizzle')
  `);
  if (rows.length === 0) {
    console.log('No tables to truncate.');
    return;
  }
  const list = rows.map((r) => r.fq).join(', ');
  console.log(`Truncating ${rows.length} tables...`);
  await pool.query(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
  console.log('✅  All data tables truncated.');
}

run()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => pool.end());
