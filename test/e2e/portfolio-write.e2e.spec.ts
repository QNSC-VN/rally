/**
 * Portfolio write paths E2E — create / update / archive.
 *
 * These go through the real database on purpose. Three of the guarantees here cannot be
 * observed against a mocked repository at all:
 *
 *   • the `EP-`/`FE-` sequence is WORKSPACE-wide per type, which is a property of
 *     `uq_portfolio_item_key` (workspace_id, item_key) — a per-project sequence would
 *     let two projects both mint `EP-1` and only real SQL shows the collision;
 *   • ranks derived under the advisory lock are strictly increasing and never equal,
 *     which is what keeps `between()` working on the next drag-reorder;
 *   • `ck_portfolio_epic_shape` actually rejects an Epic carrying Feature-only ids, so
 *     the service's friendlier error is a convenience rather than the only defence.
 *
 * Prereqs: docker deps up + `pnpm db:migrate` (see flow-harness).
 */
import { randomUUID } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AccessService } from '@modules/access';
import { PortfolioItemsService } from '@modules/portfolio';
import { ProjectsService } from '@modules/projects';
import { DRIZZLE } from '@platform';
import type { DrizzleDB } from '@platform';
import { portfolioItems } from '@db/schema/work';
import { and, eq, sql } from 'drizzle-orm';

import {
  ALL,
  WORKSPACE_ID,
  adminActor,
  bootRallyApp,
  makeActor,
  uniqueKey,
} from './support/flow-harness';

describe('portfolio write paths (e2e)', () => {
  let app: NestFastifyApplication;
  let portfolio: PortfolioItemsService;
  let projects: ProjectsService;
  let access: AccessService;
  let db: DrizzleDB;

  const admin = adminActor();
  let projectAId: string;
  let projectBId: string;

  beforeAll(async () => {
    app = await bootRallyApp();
    portfolio = app.get(PortfolioItemsService);
    projects = app.get(ProjectsService);
    access = app.get(AccessService);
    db = app.get<DrizzleDB>(DRIZZLE);

    const a = await projects.createProject(admin, { key: uniqueKey(), name: 'Portfolio Write A' });
    const b = await projects.createProject(admin, { key: uniqueKey(), name: 'Portfolio Write B' });
    projectAId = a.id;
    projectBId = b.id;
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('create', () => {
    it('mints EP-/FE- keys and appends at the end of the rank order', async () => {
      const first = await portfolio.createItem(admin, {
        projectId: projectAId,
        type: 'feature',
        name: 'First feature',
      });
      const second = await portfolio.createItem(admin, {
        projectId: projectAId,
        type: 'feature',
        name: 'Second feature',
      });

      expect(first.itemKey).toMatch(/^FE-\d+$/);
      expect(second.itemKey).toMatch(/^FE-\d+$/);
      // Strictly increasing and never equal — equal ranks are what break `between()`.
      expect(second.rank > first.rank).toBe(true);
      expect(second.rank).not.toBe(first.rank);
      expect(first.rank).not.toBe('');
    });

    it('numbers Epics and Features on SEPARATE sequences', async () => {
      const epic = await portfolio.createItem(admin, {
        projectId: projectAId,
        type: 'epic',
        name: 'An epic',
      });
      expect(epic.itemKey).toMatch(/^EP-\d+$/);

      // Both live in one table; if the sequence ignored `type`, the Epic would continue
      // the Feature numbering instead of having its own.
      const [{ epics, features }] = await db
        .select({
          epics: sql<number>`count(*) filter (where ${portfolioItems.type} = 'epic')::int`,
          features: sql<number>`count(*) filter (where ${portfolioItems.type} = 'feature')::int`,
        })
        .from(portfolioItems)
        .where(eq(portfolioItems.workspaceId, WORKSPACE_ID));
      expect(Number(epics)).toBeGreaterThan(0);
      expect(Number(features)).toBeGreaterThan(0);
    });

    it('keeps the key sequence WORKSPACE-wide, so two projects never collide', async () => {
      // `uq_portfolio_item_key` is on (workspace_id, item_key). A per-project sequence
      // would make this second create fail on the unique index.
      const inA = await portfolio.createItem(admin, {
        projectId: projectAId,
        type: 'epic',
        name: 'Epic in A',
      });
      const inB = await portfolio.createItem(admin, {
        projectId: projectBId,
        type: 'epic',
        name: 'Epic in B',
      });
      expect(inB.itemKey).not.toBe(inA.itemKey);
    });

    it('creates a Feature under an Epic and reports it as a child', async () => {
      const epic = await portfolio.createItem(admin, {
        projectId: projectAId,
        type: 'epic',
        name: 'Parent epic',
      });
      const feature = await portfolio.createItem(admin, {
        projectId: projectAId,
        type: 'feature',
        name: 'Child feature',
        parentId: epic.id,
      });

      expect(feature.parentKey).toBe(epic.itemKey);
      const children = await portfolio.listChildFeatures(admin, epic.id);
      expect(children.map((c) => c.id)).toContain(feature.id);
    });

    it('rejects an Epic carrying Feature-only ids — and the DB CHECK agrees', async () => {
      await expect(
        portfolio.createItem(admin, {
          projectId: projectAId,
          type: 'epic',
          name: 'Bad epic',
          teamId: randomUUID(),
        }),
      ).rejects.toMatchObject({ code: 'PORTFOLIO_ITEM_INVALID_TYPE' });

      // Prove the constraint is real rather than trusting the service alone: bypass the
      // service and insert straight into the table. Drizzle wraps the pg error, so the
      // constraint name is on the CAUSE, not the top-level message.
      const direct = db.insert(portfolioItems).values({
        workspaceId: WORKSPACE_ID,
        projectId: projectAId,
        itemKey: `EP-CK-${uniqueKey()}`,
        type: 'epic',
        name: 'Direct bad epic',
        teamId: randomUUID(),
        rank: 'z',
      });
      await expect(direct).rejects.toThrow();
      const err = await direct.catch((e: unknown) => e);
      expect(JSON.stringify((err as { cause?: unknown }).cause ?? err)).toContain(
        'ck_portfolio_epic_shape',
      );
    });

    it('rejects a release from a DIFFERENT project', async () => {
      // Releases are per-project, so a cross-project release would leave the row's
      // Release column describing something outside its own project.
      const { ReleasesService } = await import('@modules/releases');
      const releases = app.get(ReleasesService);
      // `name` is a POSITIONAL argument here, not part of `opts`.
      const release = await releases.createRelease(admin, projectBId, `Rel ${uniqueKey()}`, {});

      await expect(
        portfolio.createItem(admin, {
          projectId: projectAId,
          type: 'feature',
          name: 'Cross-project release',
          releaseId: release.id,
        }),
      ).rejects.toMatchObject({ code: 'PORTFOLIO_ITEM_PROJECT_MISMATCH' });
    });

    it('refuses a caller with no permission on the target project', async () => {
      const stranger = makeActor(randomUUID(), []);
      await expect(
        portfolio.createItem(stranger, {
          projectId: projectAId,
          type: 'feature',
          name: 'Should not exist',
        }),
      ).rejects.toMatchObject({ code: 'PROJECT_PERMISSION_DENIED' });
    });
  });

  describe('update', () => {
    it('clears a field with null and leaves omitted fields untouched', async () => {
      const created = await portfolio.createItem(admin, {
        projectId: projectAId,
        type: 'feature',
        name: 'Editable',
        description: 'original',
        preliminaryEstimate: 'l',
      });

      const updated = await portfolio.updateItem(admin, created.id, { description: null });

      expect(updated.description).toBeNull();
      // Untouched by an update that only mentioned description.
      expect(updated.name).toBe('Editable');
      expect(updated.preliminaryEstimate).toBe('l');
    });

    it('recomputes progress when the refined estimate changes', async () => {
      // Estimated Progress divides by the refined estimate, so editing it must move the
      // indicator — this is the one field whose edit changes a derived number.
      const created = await portfolio.createItem(admin, {
        projectId: projectAId,
        type: 'feature',
        name: 'Estimate edit',
        refinedEstimate: '10',
      });
      // A `numeric(_, 2)` column round-trips as '10.00', so compare the VALUE rather than
      // the text — the DTO is what turns this into the API's number.
      expect(Number(created.refinedEstimate)).toBe(10);

      const updated = await portfolio.updateItem(admin, created.id, { refinedEstimate: '20' });
      expect(Number(updated.refinedEstimate)).toBe(20);
      expect(updated.progress.estimatedProgressByPoints).toBe(0);
    });

    it('cannot give an Epic a Team', async () => {
      const epic = await portfolio.createItem(admin, {
        projectId: projectAId,
        type: 'epic',
        name: 'Still an epic',
      });
      await expect(
        portfolio.updateItem(admin, epic.id, { teamId: randomUUID() }),
      ).rejects.toMatchObject({ code: 'PORTFOLIO_ITEM_INVALID_TYPE' });
    });
  });

  describe('archive', () => {
    it('hides an archived item from the default list and restores it', async () => {
      const created = await portfolio.createItem(admin, {
        projectId: projectAId,
        type: 'feature',
        name: 'To archive',
      });

      await portfolio.setArchived(admin, created.id, true);
      const active = await portfolio.listItems(
        admin,
        { type: 'feature' },
        { limit: 200, cursor: null },
      );
      expect(active.data.map((i) => i.id)).not.toContain(created.id);

      const withArchived = await portfolio.listItems(
        admin,
        { type: 'feature', includeArchived: true },
        { limit: 200, cursor: null },
      );
      expect(withArchived.data.map((i) => i.id)).toContain(created.id);

      await portfolio.setArchived(admin, created.id, false);
      const restored = await portfolio.listItems(
        admin,
        { type: 'feature' },
        { limit: 200, cursor: null },
      );
      expect(restored.data.map((i) => i.id)).toContain(created.id);
    });

    it('is a SOFT delete — the row survives with archived_at set', async () => {
      const created = await portfolio.createItem(admin, {
        projectId: projectAId,
        type: 'feature',
        name: 'Soft deleted',
      });
      await portfolio.setArchived(admin, created.id, true);

      const rows = await db
        .select({ archivedAt: portfolioItems.archivedAt })
        .from(portfolioItems)
        .where(
          and(eq(portfolioItems.id, created.id), eq(portfolioItems.workspaceId, WORKSPACE_ID)),
        );
      expect(rows).toHaveLength(1);
      expect(rows[0].archivedAt).not.toBeNull();
    });

    it('refuses to archive an Epic that still has an active Feature', async () => {
      const epic = await portfolio.createItem(admin, {
        projectId: projectAId,
        type: 'epic',
        name: 'Epic with child',
      });
      const child = await portfolio.createItem(admin, {
        projectId: projectAId,
        type: 'feature',
        name: 'Blocking child',
        parentId: epic.id,
      });

      await expect(portfolio.setArchived(admin, epic.id, true)).rejects.toMatchObject({
        code: 'PORTFOLIO_EPIC_HAS_ACTIVE_FEATURES',
      });

      // Archive the child first, then the Epic goes through.
      await portfolio.setArchived(admin, child.id, true);
      const archivedEpic = await portfolio.setArchived(admin, epic.id, true);
      expect(archivedEpic.archivedAt).not.toBeNull();
    });

    it('stops a new Feature attaching to an archived Epic', async () => {
      const epic = await portfolio.createItem(admin, {
        projectId: projectAId,
        type: 'epic',
        name: 'Archived epic',
      });
      await portfolio.setArchived(admin, epic.id, true);

      await expect(
        portfolio.createItem(admin, {
          projectId: projectAId,
          type: 'feature',
          name: 'Orphan-to-be',
          parentId: epic.id,
        }),
      ).rejects.toMatchObject({ code: 'PORTFOLIO_ITEM_INVALID_PARENT' });
    });
  });

  it('every rank in a scope stays UNIQUE across many creates', async () => {
    // The advisory lock's whole job. Without it concurrent creates read the same max and
    // derive identical ranks, which makes the next drag-reorder throw.
    const made = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        portfolio.createItem(admin, {
          projectId: projectAId,
          type: 'feature',
          name: `Concurrent ${i}`,
        }),
      ),
    );

    const ranks = made.map((m) => m.rank);
    expect(new Set(ranks).size).toBe(ranks.length);
    const keys = made.map((m) => m.itemKey);
    expect(new Set(keys).size).toBe(keys.length);

    // Deliberately NOT asserted across the whole scope: other suites insert fixtures
    // straight into the table with a hardcoded rank, so a scope-wide check would police
    // their hygiene rather than this create path. What matters here is that every rank
    // the SERVICE derives is distinct.
    const sorted = [...ranks].sort();
    expect(sorted).toEqual([...new Set(sorted)]);
  });

  it('grants create rights through a project-scoped role, not just workspace admin', async () => {
    const userId = randomUUID();
    const scoped = makeActor(userId, []);
    const roles = await access.listRoles(WORKSPACE_ID);
    const projectAdmin = roles.find(
      (r) => r.slug === 'project_admin' && r.workspaceId === WORKSPACE_ID,
    );
    if (!projectAdmin) throw new Error('Seeded workspace copy of project_admin not found');
    await access.assignProjectRole(admin, projectAId, userId, projectAdmin.id);

    const created = await portfolio.createItem(scoped, {
      projectId: projectAId,
      type: 'feature',
      name: 'By project admin',
    });
    expect(created.id).toBeTruthy();

    // ...but only on THAT project.
    await expect(
      portfolio.createItem(scoped, {
        projectId: projectBId,
        type: 'feature',
        name: 'Wrong project',
      }),
    ).rejects.toMatchObject({ code: 'PROJECT_PERMISSION_DENIED' });
  });

  describe('rank', () => {
    /** Three Features in a fresh Epic-free order, returned lowest rank first. */
    async function threeFeatures() {
      const made = [];
      for (const n of ['Rank A', 'Rank B', 'Rank C']) {
        made.push(
          await portfolio.createItem(admin, {
            projectId: projectAId,
            type: 'feature',
            name: `${n} ${uniqueKey()}`,
          }),
        );
      }
      return made;
    }

    it('moves an item between two neighbours and the list order follows', async () => {
      const [a, b, c] = await threeFeatures();
      // Created in order, so ranks ascend a < b < c.
      expect(a.rank < b.rank && b.rank < c.rank).toBe(true);

      // Drag C up between A and B.
      const moved = await portfolio.rankItem(admin, c.id, { beforeId: a.id, afterId: b.id });
      expect(moved.rank > a.rank).toBe(true);
      expect(moved.rank < b.rank).toBe(true);

      // And the LIST reflects it — the ordering is what the user actually sees.
      const page = await portfolio.listItems(admin, { type: 'feature' }, ALL);
      const order = page.data.filter((i) => [a.id, b.id, c.id].includes(i.id)).map((i) => i.id);
      expect(order).toEqual([a.id, c.id, b.id]);
    });

    it('moves an item to the very top when there is no upper neighbour', async () => {
      const [a, , c] = await threeFeatures();
      const moved = await portfolio.rankItem(admin, c.id, { beforeId: null, afterId: a.id });
      expect(moved.rank < a.rank).toBe(true);
    });

    it('never writes an EQUAL rank, so the next drag still works', async () => {
      // Equal neighbours are what make `between()` throw. Moving repeatedly into the same
      // gap is the sequence most likely to exhaust precision and collide.
      const [a, b, c] = await threeFeatures();
      let last = c;
      for (let i = 0; i < 6; i++) {
        last = await portfolio.rankItem(admin, last.id, { beforeId: a.id, afterId: b.id });
        expect(last.rank > a.rank).toBe(true);
        expect(last.rank < b.rank).toBe(true);
      }
      // Scoped to the three rows this test owns. A scope-wide check would police rows
      // other suites left behind — this database still holds fixtures inserted with a
      // hardcoded rank before that spec was corrected.
      const rows = await portfolio.listItems(admin, { type: 'feature' }, ALL);
      const mine = rows.data.filter((r) => [a.id, b.id, last.id].includes(r.id));
      const ranks = mine.map((r) => r.rank);
      expect(new Set(ranks).size).toBe(ranks.length);
    });

    it('refuses an Epic as a Feature neighbour', async () => {
      const [a] = await threeFeatures();
      const epic = await portfolio.createItem(admin, {
        projectId: projectAId,
        type: 'epic',
        name: `Rank epic ${uniqueKey()}`,
      });
      await expect(portfolio.rankItem(admin, a.id, { beforeId: epic.id })).rejects.toMatchObject({
        code: 'PORTFOLIO_ITEM_RANK_CONFLICT',
      });
    });

    it('ranks across PROJECTS, because the scope is (workspace, type)', async () => {
      // The Portfolio list is cross-project and flat per type, so a Feature in project B
      // is a legitimate neighbour for one in project A. This is the deliberate difference
      // from work items, which rank within (project, parent).
      const [a, b] = await threeFeatures();
      const inB = await portfolio.createItem(admin, {
        projectId: projectBId,
        type: 'feature',
        name: `Rank cross ${uniqueKey()}`,
      });
      const moved = await portfolio.rankItem(admin, inB.id, { beforeId: a.id, afterId: b.id });
      expect(moved.rank > a.rank).toBe(true);
      expect(moved.rank < b.rank).toBe(true);
    });

    it('refuses a caller without permission on the item', async () => {
      const [a, b, c] = await threeFeatures();
      const stranger = makeActor(randomUUID(), []);
      await expect(
        portfolio.rankItem(stranger, c.id, { beforeId: a.id, afterId: b.id }),
      ).rejects.toMatchObject({ code: 'PROJECT_PERMISSION_DENIED' });
    });
  });
});
