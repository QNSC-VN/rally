/**
 * P5-CP-006 — a project's team feed may not offer a team the write refuses.
 *
 * `ProjectTeamDrizzleRepository.listByProject` filtered on the LINK being active and left-joined
 * `teams`, so an ARCHIVED team that was still linked came back as one of the project's teams. The
 * capacity plan's `Add Team` dialog reads exactly that feed while
 * `CapacityPlansService.assertTeamInProject` requires the link AND the team to be active — so the
 * dialog offered a team and `POST /capacity-plans/:id/teams` then answered `CAPACITY_TEAM_NOT_FOUND`
 * for it.
 *
 * Asserted against the RENDERED SQL rather than a database, because that is what the defect was: a
 * missing predicate. The query builder is driven with a recording stub and the captured `where` is
 * rendered by drizzle's own `PgDialect`, so the assertion reads the same text Postgres would — a
 * mock-shaped test ("did it call `and` with three things") would pass on the wrong three.
 *
 * Named `project-team.active-team.spec.ts` deliberately: `test/coverage-include.spec.ts` requires a
 * spec whose subject is a same-named sibling to be listed in `vitest.config.ts`'s coverage include,
 * and a repository has no unit-coverage story to add there. If a future change gives this repository a
 * canonical spec, add `project-team.drizzle-repository.ts` to that list in the same commit.
 */
import { describe, expect, it } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';

import type { DrizzleDB } from '@platform';
import { ProjectTeamDrizzleRepository } from './project-team.drizzle-repository';

/**
 * A chainable stand-in for the drizzle builder that records the `where` it is handed.
 *
 * `orderBy` returns the row array itself: awaiting a non-promise yields the value, so the repository's
 * `await` resolves without the stub having to pretend to be a thenable query.
 */
function recordingDb(rows: unknown[] = []) {
  const captured: { where?: SQL; join?: 'inner' | 'left' } = {};
  const builder = {
    select: () => builder,
    from: () => builder,
    innerJoin: () => {
      captured.join = 'inner';
      return builder;
    },
    leftJoin: () => {
      captured.join = 'left';
      return builder;
    },
    where: (condition: SQL) => {
      captured.where = condition;
      return builder;
    },
    orderBy: () => rows,
  };
  return { db: builder as unknown as DrizzleDB, captured };
}

function renderedWhere(condition: SQL | undefined): { sql: string; params: unknown[] } {
  if (condition === undefined) throw new Error('the query built no WHERE clause at all');
  const query = new PgDialect().sqlToQuery(condition);
  return { sql: query.sql, params: query.params };
}

describe('ProjectTeamDrizzleRepository.listByProject', () => {
  it('requires the TEAM to be active, not just the link', async () => {
    const { db, captured } = recordingDb();
    await new ProjectTeamDrizzleRepository(db).listByProject('proj-1');

    const { sql, params } = renderedWhere(captured.where);
    // Both status columns, both compared to 'active' — the link's status was always here; the team's
    // is the fix. Column-qualified so a predicate that checked the same column twice cannot pass.
    expect(sql).toContain('"project_teams"."status"');
    expect(sql).toContain('"teams"."status"');
    expect(params).toEqual(['proj-1', 'active', 'active']);
  });

  it('joins teams as an INNER join, because the predicate can no longer admit a NULL team', () => {
    // A `leftJoin` here would describe a result set the WHERE makes unreachable: `teams.status` can
    // never equal 'active' on a row with no team. There is no FK on `project_teams.team_id`, so an
    // orphan link is possible from raw SQL — it drops out, which is the honest answer for a link
    // naming a team that does not exist.
    const { db, captured } = recordingDb();
    void new ProjectTeamDrizzleRepository(db).listByProject('proj-1');
    expect(captured.join).toBe('inner');
  });

  it('returns the joined rows as-is', async () => {
    // The coalescing the left join needed (`name ?? undefined`) is gone with it; this pins that the
    // rows still come back rather than being dropped by the mapping.
    const rows = [{ id: 'link-1', teamId: 't1', name: 'Team Alpha', key: 'ALP' }];
    const { db } = recordingDb(rows);
    await expect(new ProjectTeamDrizzleRepository(db).listByProject('proj-1')).resolves.toEqual(
      rows,
    );
  });
});
