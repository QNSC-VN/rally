/**
 * CI helper — make `rally_app` usable for one test run, then prove it is not
 * over-privileged.
 *
 * Migration 0068 creates `rally_app` NOLOGIN, because granting it a password is
 * a deliberate production cutover step (docs/runbooks/db-role-least-privilege.md),
 * not something a migration should do. CI still needs to connect as it: every
 * other job in backend-ci.yml talks to Postgres as the superuser, which owns
 * every object, so a schema or sequence the migration forgot to GRANT would pass
 * CI and surface only after the real cutover — as `permission denied for …` on
 * the first request in production.
 *
 * Two things happen here:
 *   1. ALTER ROLE … LOGIN, so the e2e suite can run as the restricted role.
 *   2. A negative check: `rally_app` must NOT be able to run DDL. If the grants
 *      are ever widened to ownership, this fails loudly instead of quietly
 *      making the whole split decorative.
 *
 * Uses `pg` (a direct dependency) rather than psql — the runner image is not
 * guaranteed to ship a Postgres client, and nothing else in this repo assumes one.
 */
import { Client } from 'pg';

const ADMIN_URL = process.env.ADMIN_DATABASE_URL;
const ROLE = process.env.LEAST_PRIVILEGE_ROLE ?? 'rally_app';
const PASSWORD = process.env.LEAST_PRIVILEGE_PASSWORD ?? 'rally_app';

if (!ADMIN_URL) {
  console.error('❌  ADMIN_DATABASE_URL is required (the owner/superuser connection).');
  process.exit(1);
}

/**
 * `ALTER ROLE` is utility DDL: the grammar takes neither an identifier nor a
 * password as a bind parameter, so both must be interpolated. Validate them
 * instead — this only ever runs against an ephemeral CI database, but an
 * un-checked interpolation here would still be an injection sink.
 */
if (!/^[a-z_][a-z0-9_]*$/.test(ROLE)) {
  console.error(`❌  Refusing to interpolate an unsafe role name: ${ROLE}`);
  process.exit(1);
}
if (!/^[A-Za-z0-9_-]+$/.test(PASSWORD)) {
  console.error('❌  LEAST_PRIVILEGE_PASSWORD must be [A-Za-z0-9_-] only.');
  process.exit(1);
}

const admin = new Client({ connectionString: ADMIN_URL });
await admin.connect();

const { rows } = await admin.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [ROLE]);
if (rows.length === 0) {
  console.error(
    `❌  Role ${ROLE} does not exist. Migration 0068 should have created it — ` +
      'has db:migrate run against this database?',
  );
  await admin.end();
  process.exit(1);
}

await admin.query(`ALTER ROLE ${ROLE} LOGIN PASSWORD '${PASSWORD}'`);
await admin.end();

const appUrl = new URL(ADMIN_URL);
appUrl.username = ROLE;
appUrl.password = PASSWORD;

const app = new Client({ connectionString: appUrl.toString() });
await app.connect();

let ddlAllowed = false;
try {
  await app.query('CREATE TABLE work.ci_privilege_probe (id int)');
  ddlAllowed = true;
  await app.query('DROP TABLE work.ci_privilege_probe');
} catch {
  // Expected: permission denied. DML-only is the whole point of the role.
}
await app.end();

if (ddlAllowed) {
  console.error(
    `❌  ${ROLE} was able to CREATE TABLE. It must hold DML rights only — ` +
      'check the GRANTs in db/migrations/0068_app_role_least_privilege.sql.',
  );
  process.exit(1);
}

console.log(`✅  ${ROLE} can log in, and cannot run DDL.`);
