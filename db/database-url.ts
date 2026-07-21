/**
 * Single source of truth for the Postgres connection URL.
 *
 * Two ways to supply it, checked in this order:
 *
 *  1. DATABASE_URL — a complete URL. Used by local dev, CI, and anything with a
 *     static credential. Returned untouched.
 *
 *  2. DATABASE_HOST / PORT / NAME / USER / PASSWORD — composed here.
 *     This is the deployed path. Host/port/name are plain (non-secret) env vars
 *     from Terraform; user and password are injected by ECS straight from the
 *     RDS-managed secret via its `:json-key::` selector.
 *
 * WHY THE SPLIT EXISTS
 *
 * RDS is created with `manage_master_user_password = true`, so AWS owns the
 * password and rotates it on its own schedule, storing it in an AWS-managed
 * Secrets Manager secret. The app previously read a SEPARATE, hand-populated
 * `db-url` secret containing a copy of that password. Every rotation silently
 * invalidated that copy, and the next deploy died with
 * `28P01 password authentication failed for user "app_admin"` — with nothing
 * drifting in Terraform to hint at why.
 *
 * Composing from parts removes the copy entirely. ECS reads the managed secret
 * at task start, so a rotated password is picked up by the next task without a
 * human touching anything. It also keeps the password out of Terraform state,
 * which is what would happen if Terraform built the URL itself.
 *
 * ROTATION CAVEAT: credentials are injected at task START. If AWS rotates while
 * tasks are running, already-open connections survive but new ones fail until
 * the task restarts. That is inherent to ECS secret injection, not to this
 * helper. The task health check surfaces it and the service replaces the task.
 */

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `Database configuration incomplete: ${name} is required when DATABASE_URL is not set. ` +
        'Set DATABASE_URL (local/CI) or all of DATABASE_HOST, DATABASE_PORT, ' +
        'DATABASE_NAME, DATABASE_USER, DATABASE_PASSWORD (deployed).',
    );
  }
  return value;
}

export interface DatabaseUrlParts {
  DATABASE_URL?: string;
  DATABASE_HOST?: string;
  DATABASE_PORT?: string | number;
  DATABASE_NAME?: string;
  DATABASE_USER?: string;
  DATABASE_PASSWORD?: string;
  DATABASE_SSLMODE?: string;
}

/**
 * Resolve the connection URL from an env-like bag.
 *
 * User and password are percent-encoded: an AWS-generated password routinely
 * contains characters that are structural in a URL (`@`, `/`, `:`, `?`, `#`).
 * Interpolating one raw produces either a parse error or — worse — a URL that
 * parses into the wrong host.
 */
export function resolveDatabaseUrl(env: DatabaseUrlParts = process.env): string {
  if (env.DATABASE_URL) return env.DATABASE_URL;

  const host = required('DATABASE_HOST', env.DATABASE_HOST);
  const port = required('DATABASE_PORT', env.DATABASE_PORT?.toString());
  const name = required('DATABASE_NAME', env.DATABASE_NAME);
  const user = required('DATABASE_USER', env.DATABASE_USER);
  const password = required('DATABASE_PASSWORD', env.DATABASE_PASSWORD);
  const sslmode = env.DATABASE_SSLMODE ?? 'require';

  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${name}?sslmode=${sslmode}`;
}

/**
 * The migration/DDL connection. Falls back to the app URL when no separate
 * privileged credential is configured.
 */
export function resolveMigrationUrl(
  env: DatabaseUrlParts & { DATABASE_MIGRATION_URL?: string } = process.env,
): string {
  return env.DATABASE_MIGRATION_URL ?? resolveDatabaseUrl(env);
}
