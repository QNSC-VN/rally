/**
 * ONE reset for the whole BE e2e run: truncate the delivery tables, then re-seed the two fixtures.
 *
 * Why this exists. Every `afterAll` in the suite closed the Nest app and cleaned NOTHING — 37 files,
 * zero teardown — while the files between them called `createProject` 84 times per run. So a dev
 * database grew by ~84 projects and their whole graph on every pass, forever. Two consequences, both
 * observed:
 *
 *   • `portfolio_items.rank` is `varchar(255)` and new ranks are derived by appending, so at ~1,900
 *     items the longest rank hit exactly 255 characters and EVERY subsequent insert failed with
 *     `value too long for type character varying(255)`. The suite could not run at all until the
 *     database was dropped by hand. That happened twice.
 *   • Tests read each other's leftovers. A list assertion that was true on a clean database becomes
 *     order-dependent once fifty other projects exist, and the failure surfaces in an unrelated file.
 *
 * Truncate rather than per-test teardown: teardown has to unwind foreign keys in the right order in
 * every file that creates anything, which is exactly the discipline that never held. One `TRUNCATE
 * ... CASCADE` at the start of the run is a single place to be correct.
 *
 * What is NOT truncated: `identity.*`, `access.*` and `workspace.*`. Users, roles, grants and the
 * workspace itself are the ground the fixtures stand on, `bootstrap.ts` reconciles them idempotently,
 * and dropping a role would take its assignments — including the ones `ensureViewerGrant` relies on.
 */
import { resetFixtureTables } from '../../../db/seeds/reset';

export default async function setup(): Promise<void> {
  // Deliberately opt-out-able: a developer bisecting one failing file may want the database left
  // exactly as it is. Default is to reset, because the default should be the correct thing.
  if (process.env.E2E_SKIP_RESET === 'true') return;

  const url = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error('E2E reset needs DATABASE_URL (or DATABASE_MIGRATION_URL).');

  // ONE table list, shared with `pnpm db:seed:test` (`db/seeds/reset.ts`). Two lists would drift, and
  // the suite would then run against a database shaped differently from a developer's.
  await resetFixtureTables(url);

  // Re-seed AFTER the truncate, in this process, so the first test file starts against the same two
  // projects a developer sees locally. Imported lazily: the seed opens its own pool and reads env,
  // and doing that at module load would run it even when the reset is skipped.
  const { seed } = await import('../../../db/seeds/seed');
  // `seed()` takes an optional connection URL and loads the FULL fixture set (both projects plus the
  // reference extras) — the same entry point `pnpm db:seed:test` uses, so the suite and a developer's
  // local database cannot drift apart.
  await seed(url);
}
