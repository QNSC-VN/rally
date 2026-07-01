try {
  process.loadEnvFile('.env');
} catch {
  /* noop */
}
import { Pool } from 'pg';
import { readFileSync } from 'fs';
import path from 'path';

const pool = new Pool({ connectionString: process.env['DATABASE_URL'], max: 1 });

async function main() {
  const out: Record<string, unknown> = {};

  // actual priority column type
  const col = await pool.query(`
    SELECT column_name, data_type, udt_name, column_default
    FROM information_schema.columns
    WHERE table_schema='work' AND table_name='work_items' AND column_name='priority'
  `);
  out.priorityColumn = col.rows[0];

  // all enum types present (names only)
  const enums = await pool.query(`
    SELECT typname FROM pg_type WHERE typtype='e' ORDER BY typname
  `);
  out.enumTypes = enums.rows.map((r) => r.typname);

  // journal when -> tag
  const journal = JSON.parse(
    readFileSync(path.join(__dirname, 'migrations/meta/_journal.json'), 'utf8'),
  );
  out.journal = journal.entries.map((e: { when: number; tag: string }) => ({
    when: String(e.when),
    tag: e.tag,
  }));

  // tracked created_at values
  const tracked = await pool.query(
    `SELECT created_at FROM drizzle.__drizzle_migrations ORDER BY created_at`,
  );
  out.trackedCreatedAt = tracked.rows.map((r) => String(r.created_at));

  console.log(JSON.stringify(out, null, 2));
  await pool.end();
}

void main();
