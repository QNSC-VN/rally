try {
  process.loadEnvFile('.env');
} catch {
  /* noop */
}
import { Pool } from 'pg';
import { readFileSync } from 'fs';
import path from 'path';

const url = process.env['DATABASE_MIGRATION_URL'] ?? process.env['DATABASE_URL'];
const pool = new Pool({ connectionString: url, max: 1 });

async function main() {
  const out: Record<string, unknown> = {};

  // Does the full 0010 object set already exist?
  const checks = await pool.query(`
    SELECT
      to_regclass('messaging.email_outbox')        AS email_outbox,
      to_regclass('messaging.notification_outbox')  AS notification_outbox,
      EXISTS(SELECT 1 FROM pg_type WHERE typname='email_job_status')        AS email_job_status,
      EXISTS(SELECT 1 FROM pg_type WHERE typname='notification_job_status') AS notif_job_status
  `);
  out.zeroTenState = checks.rows[0];

  // Transactional dry-run of 0011: apply then ROLLBACK to verify validity only.
  const sql0011 = readFileSync(
    path.join(__dirname, 'migrations/0011_phase1_work_items.sql'),
    'utf8',
  );
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql0011);
    // verify the new objects exist within the tx
    const verify = await client.query(`
      SELECT
        (SELECT array_agg(e.enumlabel ORDER BY e.enumsortorder)
           FROM pg_type t JOIN pg_enum e ON e.enumtypid=t.oid
          WHERE t.typname='work_item_priority')                            AS priority_enum,
        EXISTS(SELECT 1 FROM pg_type WHERE typname='work_item_schedule_state') AS schedule_state_enum,
        to_regclass('work.activity_logs')                                  AS activity_logs,
        (SELECT count(*) FROM information_schema.columns
          WHERE table_schema='work' AND table_name='work_items'
            AND column_name IN ('schedule_state','team_id','estimate_hours','todo_hours','actual_hours','notes','release_notes','updated_by')) AS new_cols
    `);
    out.dryRun0011 = verify.rows[0];
    out.dryRun0011Result = 'OK (rolled back)';
    await client.query('ROLLBACK');
  } catch (e) {
    await client.query('ROLLBACK');
    out.dryRun0011Result = 'FAILED: ' + (e as Error).message;
  } finally {
    client.release();
  }

  console.log(JSON.stringify(out, null, 2));
  await pool.end();
}

void main();
