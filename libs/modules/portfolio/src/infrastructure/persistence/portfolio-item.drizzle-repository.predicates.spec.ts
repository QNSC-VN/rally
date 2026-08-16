/**
 * The exact WHERE clauses of the two Feature queries that must NOT drift into each other.
 *
 * P5-PI-017 was a disagreement between two predicates sitting fifteen lines apart: the
 * `Feature` field's option feed (`listFeatureOptions`, project + type + not-archived) and the
 * Children projection (`listChildren`, the link alone). The Children tab listed a Story whose
 * `feature_id` pointed at another project's Feature while that Story's own Feature field —
 * labelling itself from the project-scoped feed — rendered the "No Feature" placeholder.
 *
 * The ruling is that only ONE of those two is a membership question, so this spec pins BOTH
 * shapes rather than making them equal: the feed stays project-scoped, `listChildren` stays
 * project-agnostic, and `listChildren` gains the type filter its own row mapping assumed.
 *
 * A predicate spec, not a repository spec — hence the `.predicates.` name. It asserts the SQL
 * these two methods BUILD, using drizzle's proxy driver so no database is involved: the fault it
 * exists to catch is a condition present or absent, which is visible in the rendered statement
 * and invisible to any test that goes through a mocked repository port. Every task spec that
 * called a service directly missed a guard defect for exactly this reason (see CLAUDE.md).
 */
import { describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/pg-proxy';
import type { DrizzleDB } from '@platform';
import { PortfolioItemDrizzleRepository } from './portfolio-item.drizzle-repository';

/** One captured statement: the SQL drizzle rendered, and the params it bound. */
interface Captured {
  sql: string;
  params: unknown[];
}

/**
 * A repository over a driver that records instead of executing.
 *
 * `rows: []` for everything — these methods are asked what they ASK FOR, not what they return.
 */
function recordingRepo(): { repo: PortfolioItemDrizzleRepository; captured: Captured[] } {
  const captured: Captured[] = [];
  const db = drizzle(async (sql, params) => {
    captured.push({ sql, params });
    return { rows: [] };
  });
  return { repo: new PortfolioItemDrizzleRepository(db as unknown as DrizzleDB), captured };
}

/**
 * Just the WHERE clause.
 *
 * The select list and the LEFT JOINs both name `project_id`, so "does this query filter by
 * project" cannot be answered by searching the whole statement — the honest test has to look at
 * the conditions alone.
 */
function whereClause(sql: string): string {
  const match = /\swhere\s(.*?)(?:\sorder by\s|\sgroup by\s|\slimit\s|$)/.exec(sql);
  if (!match) throw new Error(`No WHERE clause in: ${sql}`);
  return match[1];
}

describe('PortfolioItemDrizzleRepository — Feature membership predicates', () => {
  describe('listChildren (the Children projection)', () => {
    it('filters on the LINK, tenancy, the soft delete and the child type — and nothing else', async () => {
      const { repo, captured } = recordingRepo();

      await repo.listChildren('feature-1', 'ws-1', { limit: 50, cursor: null });

      expect(captured).toHaveLength(1);
      const where = whereClause(captured[0].sql);

      expect(where).toContain('"work_items"."feature_id" = $1');
      expect(where).toContain('"work_items"."workspace_id" = $2');
      expect(where).toContain('"work_items"."deleted_at" is null');
      // The row mapping casts every row to 'story' | 'defect'; this is what makes that true.
      expect(where).toContain('"work_items"."type" in ($3, $4)');
      expect(captured[0].params.slice(0, 4)).toEqual(['feature-1', 'ws-1', 'story', 'defect']);
    });

    it('does NOT narrow children to the Feature’s project', async () => {
      const { repo, captured } = recordingRepo();

      await repo.listChildren('feature-1', 'ws-1', { limit: 50, cursor: null });

      // A cross-project link is legal (`assertFeatureLinkable`) and the rollup counts it, so
      // hiding it here would put two answers for one row on one page.
      expect(whereClause(captured[0].sql)).not.toContain('project_id');
    });

    it('does NOT list a child of any other Feature, even under the same workspace', async () => {
      const { repo, captured } = recordingRepo();

      await repo.listChildren('feature-1', 'ws-1', { limit: 50, cursor: null, search: 'us-' });

      const where = whereClause(captured[0].sql);
      expect(where).toContain('"work_items"."feature_id" = $1');
      // The search is an extra narrowing, never a replacement for the link.
      expect(where).toMatch(/ilike/);
    });
  });

  describe('listFeatureOptions (the Feature field’s option feed)', () => {
    it('stays scoped to ONE project, to active rows, and to Features', async () => {
      const { repo, captured } = recordingRepo();

      await repo.listFeatureOptions('ws-1', 'project-1');

      expect(captured).toHaveLength(1);
      const where = whereClause(captured[0].sql);

      expect(where).toContain('"portfolio_items"."workspace_id" = $1');
      // Project-scoped BY CONTRACT (§5.3:133) — that is what lets the route's guard check it.
      expect(where).toContain('"portfolio_items"."project_id" = $2');
      expect(where).toContain('"portfolio_items"."type" = $3');
      expect(where).toContain('"portfolio_items"."archived_at" is null');
      expect(captured[0].params).toEqual(['ws-1', 'project-1', 'feature']);
    });
  });
});
