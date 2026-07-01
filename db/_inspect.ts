try {
  process.loadEnvFile('.env');
} catch {
  /* noop */
}
import { Pool } from 'pg';

const url = process.env['DATABASE_MIGRATION_URL'] ?? process.env['DATABASE_URL'];
const pool = new Pool({ connectionString: url, max: 1 });

async function main() {
  const out: Record<string, unknown> = {};

  // drizzle migration tracking tables (could be in 'drizzle' schema)
  const trackTables = await pool.query(`
    SELECT table_schema, table_name
    FROM information_schema.tables
    WHERE table_name LIKE '%drizzle_migrations%'
  `);
  out.trackTables = trackTables.rows;

  for (const t of trackTables.rows) {
    const r = await pool.query(
      `SELECT id, hash, created_at FROM "${t.table_schema}"."${t.table_name}" ORDER BY created_at`,
    );
    out[`rows_${t.table_schema}_${t.table_name}`] = r.rows;
  }

  // priority enum values
  const pr = await pool.query(`
    SELECT e.enumlabel FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'work_item_priority' ORDER BY e.enumsortorder
  `);
  out.priorityEnum = pr.rows.map((x) => x.enumlabel);

  // schedule_state enum exists?
  const ss = await pool.query(`SELECT 1 FROM pg_type WHERE typname = 'work_item_schedule_state'`);
  out.scheduleStateEnumExists = ss.rowCount;

  // work_items new columns
  const cols = await pool.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'work' AND table_name = 'work_items'
      AND column_name IN ('schedule_state','team_id','estimate_hours','todo_hours','actual_hours','notes','release_notes','updated_by')
    ORDER BY column_name
  `);
  out.workItemsNewColumns = cols.rows.map((x) => x.column_name);

  // activity_logs table
  const al = await pool.query(`
    SELECT 1 FROM information_schema.tables WHERE table_schema='work' AND table_name='activity_logs'
  `);
  out.activityLogsExists = al.rowCount;

  console.log(JSON.stringify(out, null, 2));
  await pool.end();
}

void main();
