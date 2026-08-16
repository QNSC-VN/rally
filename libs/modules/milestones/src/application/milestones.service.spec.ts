import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { DRIZZLE, NotFoundException, PreconditionFailedException } from '@platform';
import { MilestonesService } from './milestones.service';
import { MILESTONE_REPOSITORY } from '../domain/ports/milestone.repository';
import { ProjectsService } from '@modules/projects';
import { AccessService } from '@modules/access';
import { ActivityLogger } from '@modules/activity';
import type { Milestone } from '../domain/milestone.types';

const activityMock = () => ({
  build: vi.fn(() => ({})),
  buildDiff: vi.fn(() => []),
  log: vi.fn(async () => undefined),
  logSafe: vi.fn(async () => undefined),
  listFor: vi.fn(async () => ({ data: [], total: 0, page: 1, pageSize: 50 })),
});

// ── Fixtures ──────────────────────────────────────────────────────────────────

const now = new Date('2024-06-01');

const actor = {
  sub: 'user-1',
  workspaceId: 'ws-1',
  contextId: 'ws-1',
  sessionId: 's1',
  jti: 'j1',
  iat: 0,
  exp: 0,
  iss: 'rally',
  aud: 'rally-app',
  permissions: [] as string[],
  claims: { permissions: [] as string[] },
  authMethod: 'password' as const,
};

const mockMilestone = (o: Partial<Milestone> = {}): Milestone => ({
  id: 'ms-1',
  workspaceId: 'ws-1',
  projectId: 'proj-1',
  milestoneKey: 'MS-1',
  name: 'MVP Launch',
  description: null,
  notes: null,
  status: 'planned',
  ownerId: 'user-1',
  targetStartDate: null,
  targetEndDate: null,
  releaseIds: [],
  createdAt: now,
  updatedAt: now,
  ...o,
});

const emptyPage = {
  data: [],
  pageInfo: { nextCursor: null, hasNextPage: false, limit: 25 },
};

// ── Mock factories ────────────────────────────────────────────────────────────

const makeRepo = () => ({
  findById: vi.fn().mockResolvedValue(mockMilestone()),
  listByProject: vi.fn().mockResolvedValue(emptyPage),
  nextKeyNumber: vi.fn().mockResolvedValue(1),
  create: vi.fn().mockImplementation((input) => Promise.resolve(mockMilestone(input))),
  update: vi
    .fn()
    .mockImplementation((id, patch) =>
      Promise.resolve(mockMilestone({ id, ...patch, releaseIds: [] })),
    ),
  delete: vi.fn().mockResolvedValue(undefined),
  setReleaseLinks: vi.fn().mockResolvedValue(undefined),
  getReleaseIds: vi.fn().mockResolvedValue([]),
  deriveTargetDates: vi.fn().mockResolvedValue({
    startDate: '2024-06-01',
    endDate: '2024-08-01',
  }),
  getProjectIds: vi.fn().mockResolvedValue([]),
  setProjectLinks: vi.fn().mockResolvedValue(undefined),
  getTeamIds: vi.fn().mockResolvedValue([]),
  setTeamLinks: vi.fn().mockResolvedValue(undefined),
  getArtifactIds: vi.fn().mockResolvedValue([]),
  setArtifactLinks: vi.fn().mockResolvedValue(undefined),
});

const makeProjects = () => ({
  getProject: vi.fn().mockResolvedValue({ id: 'proj-1' }),
  assertProjectWritable: vi.fn().mockResolvedValue(undefined),
});

const makeAccess = () => ({
  assertProjectPermission: vi.fn().mockResolvedValue(undefined),
});

/**
 * Flexible mock DB. The root object is deliberately NOT thenable — Nest's DI
 * awaits thenable useValue providers, which would unwrap the mock into its
 * resolved value and leave the service without a `.select`. Only the query
 * chain returned by `select()`/`update()` is awaitable.
 */
const makeChain = (result: unknown) => {
  const chain: Record<string, unknown> = {};
  for (const key of [
    'from',
    'where',
    'groupBy',
    'innerJoin',
    'leftJoin',
    'set',
    'limit',
    'orderBy',
    'returning',
  ]) {
    chain[key] = vi.fn().mockReturnValue(chain);
  }
  // Awaitable terminal: any point in the chain resolves to `result`.
  chain.then = (resolve: (v: unknown) => void) => resolve(result);
  return chain;
};

/**
 * The raw SQL TEXT of a drizzle predicate, for assertions about a query's SHAPE.
 *
 * A drizzle `SQL` is a chunk list: literal `StringChunk`s (whose `value` is a string array) plus
 * tables, columns, params and nested `SQL`s. Flattening only the literal chunks is enough to prove a
 * predicate reaches a given column — and unlike asserting on returned rows, which come from the mock,
 * it cannot pass when the predicate is wrong.
 */
const flattenSql = (node: unknown): string => {
  if (node == null || typeof node !== 'object') return '';
  const rec = node as Record<string, unknown>;
  if (Array.isArray(rec.value) && rec.value.every((v) => typeof v === 'string')) {
    return rec.value.join(' ');
  }
  const chunks = rec.queryChunks ?? rec.chunks ?? rec.conditions ?? rec.value;
  if (Array.isArray(chunks)) return chunks.map(flattenSql).join(' ');
  return '';
};

/**
 * The flattened SQL of the FIRST `where(...)` a chain received.
 *
 * `makeChain` is a `Record<string, unknown>` bag, so its members are `unknown` — the cast lives here,
 * once, rather than at every assertion site.
 */
const whereSql = (chain: Record<string, unknown>): string =>
  flattenSql((chain.where as Mock).mock.calls[0][0]);

const makeDb = (overrides?: { selectResult?: unknown[]; updateResult?: unknown }) => ({
  select: vi.fn(() => makeChain(overrides?.selectResult ?? [])),
  update: vi.fn(() => makeChain(overrides?.updateResult ?? undefined)),
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('MilestonesService', () => {
  let service: MilestonesService;
  let repo: ReturnType<typeof makeRepo>;
  let projects: ReturnType<typeof makeProjects>;
  let access: ReturnType<typeof makeAccess>;
  let db: ReturnType<typeof makeDb>;

  beforeEach(async () => {
    repo = makeRepo();
    projects = makeProjects();
    access = makeAccess();
    db = makeDb();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MilestonesService,
        { provide: MILESTONE_REPOSITORY, useValue: repo },
        { provide: ProjectsService, useValue: projects },
        { provide: AccessService, useValue: access },
        { provide: DRIZZLE, useValue: db },
        { provide: ActivityLogger, useValue: activityMock() },
      ],
    }).compile();

    service = module.get(MilestonesService);
  });

  // ── listMilestones ────────────────────────────────────────────────────────

  describe('listMilestones', () => {
    it('validates project access before listing', async () => {
      await service.listMilestones(actor, 'proj-1', { limit: 25, cursor: null });
      expect(projects.getProject).toHaveBeenCalledWith('ws-1', 'proj-1');
    });

    it('propagates project-not-found', async () => {
      projects.getProject.mockRejectedValue(new Error('PROJECT_NOT_FOUND'));
      await expect(
        service.listMilestones(actor, 'bad', { limit: 25, cursor: null }),
      ).rejects.toThrow('PROJECT_NOT_FOUND');
    });
  });

  // ── createMilestone ──────────────────────────────────────────────────────

  describe('createMilestone', () => {
    it('creates with default planned status', async () => {
      const result = await service.createMilestone(actor, 'proj-1', 'MVP');
      expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ status: 'planned' }));
      expect(result.status).toBe('planned');
    });

    it('uses provided status when given', async () => {
      await service.createMilestone(actor, 'proj-1', 'MVP', { status: 'active' });
      expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ status: 'active' }));
    });

    it('calls recalcTargetDates via DB when releases are linked', async () => {
      const releaseIds = ['rel-1', 'rel-2'];
      // Guard + recalc share this.db.select; return one row per linked id so the
      // in-workspace COUNT check passes (rows.length === releaseIds.length).
      db.select.mockReturnValue(makeChain([{ id: 'rel-1' }, { id: 'rel-2' }]));

      // recalcTargetDates does: db.select().from().innerJoin().where() => aggregates
      // then db.update().set().where() to persist
      await service.createMilestone(actor, 'proj-1', 'MVP', {
        releaseIds,
      });

      expect(repo.setReleaseLinks).toHaveBeenCalledWith(expect.any(String), releaseIds);
      // recalcTargetDates uses db.select (the select chain is thenable)
      expect(db.select).toHaveBeenCalled();
      // create fetches the final row once, after links + recalc
      expect(repo.findById).toHaveBeenCalledTimes(1);
    });

    it('keeps manual target dates when no releases linked', async () => {
      // No linked Release → dates are user-managed (SRS §2); the manual values
      // reach repo.create and recalcTargetDates does not override them.
      await service.createMilestone(actor, 'proj-1', 'MVP', {
        releaseIds: [],
        targetStartDate: '2024-05-01',
        targetEndDate: '2024-12-31',
      });

      expect(repo.setReleaseLinks).not.toHaveBeenCalled();
      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          targetStartDate: '2024-05-01',
          targetEndDate: '2024-12-31',
        }),
      );
    });

    it('persists manual dates to create and derives from releases when linked', async () => {
      const releaseIds = ['rel-1', 'rel-2'];
      db.select.mockReturnValue(makeChain([{ id: 'rel-1' }, { id: 'rel-2' }]));

      await service.createMilestone(actor, 'proj-1', 'MVP', {
        releaseIds,
        targetStartDate: '2024-05-01',
        targetEndDate: '2024-12-31',
      });

      // Links are set and manual dates reach repo.create (persisted); the derived
      // Release window then overrides them via recalcTargetDates.
      expect(repo.setReleaseLinks).toHaveBeenCalledWith(expect.any(String), releaseIds);
      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({ targetStartDate: '2024-05-01' }),
      );
    });

    it('validates project exists before creating', async () => {
      projects.assertProjectWritable.mockRejectedValue(new Error('PROJECT_NOT_FOUND'));
      await expect(service.createMilestone(actor, 'bad', 'MVP')).rejects.toThrow(
        'PROJECT_NOT_FOUND',
      );
      expect(repo.create).not.toHaveBeenCalled();
    });
  });

  // ── getMilestone ─────────────────────────────────────────────────────────

  describe('getMilestone', () => {
    it('returns milestone when found in same workspace', async () => {
      repo.findById.mockResolvedValue(mockMilestone());
      const result = await service.getMilestone('ws-1', 'ms-1');
      expect(result.id).toBe('ms-1');
    });

    it('throws when not found', async () => {
      repo.findById.mockResolvedValue(null);
      await expect(service.getMilestone('ws-1', 'bad')).rejects.toThrow(NotFoundException);
    });

    it('throws when milestone belongs to different workspace', async () => {
      repo.findById.mockResolvedValue(mockMilestone({ workspaceId: 'other-ws' }));
      await expect(service.getMilestone('ws-1', 'ms-1')).rejects.toThrow(NotFoundException);
    });

    // milestone:view is enforced by the PolicyGuard at the route (P2,
    // resource-resolved from :id), covered by e2e — not a service assert.

    it('does NOT repair the derived dates on read — a read is a read', async () => {
      /**
       * Inverted deliberately. `getMilestone` used to call `recalcTargetDates`, which is why the detail
       * page always looked right while `listMilestones` showed a stale window after a linked Release's
       * dates changed: the surface a reviewer checks was the one that healed itself, so the real defect
       * hid behind it.
       *
       * The derived window is an equality (P3-MS-FR-011/012, SRS §73), maintained by migration 0097's
       * triggers on all three writes that can invalidate it. One row read, one findById.
       */
      repo.findById.mockResolvedValue(mockMilestone());
      await service.getMilestone('ws-1', 'ms-1');
      expect(repo.findById).toHaveBeenCalledTimes(1);
    });
  });

  // ── updateMilestone ──────────────────────────────────────────────────────

  describe('updateMilestone', () => {
    // Authorization (milestone:edit) enforced by the PolicyGuard at the route (P2).

    it('recalculates target dates via DB when releaseIds change', async () => {
      repo.findById.mockResolvedValue(mockMilestone());
      repo.getReleaseIds.mockResolvedValue(['rel-new']);
      db.select.mockReturnValue(makeChain([{ id: 'rel-new' }]));

      await service.updateMilestone(actor, 'ms-1', {
        releaseIds: ['rel-new'],
      });

      expect(repo.setReleaseLinks).toHaveBeenCalledWith('ms-1', ['rel-new']);
      // recalcTargetDates uses db.select
      expect(db.select).toHaveBeenCalled();
    });

    it('does not clear dates when releaseIds set to empty (they become manual)', async () => {
      repo.findById.mockResolvedValue(
        mockMilestone({
          targetStartDate: '2024-06-01',
          targetEndDate: '2024-09-01',
        }),
      );

      await service.updateMilestone(actor, 'ms-1', {
        releaseIds: [],
      });

      expect(repo.setReleaseLinks).toHaveBeenCalledWith('ms-1', []);
      // recalcTargetDates runs its aggregate SELECT but, with no linked Release,
      // leaves the stored dates untouched (they are now user-managed).
      expect(db.select).toHaveBeenCalled();
    });

    it('does not change release links when releaseIds is not in the input', async () => {
      repo.findById.mockResolvedValue(mockMilestone());

      await service.updateMilestone(actor, 'ms-1', { name: 'Renamed' });
      expect(repo.setReleaseLinks).not.toHaveBeenCalled();
    });

    it('includes releaseIds in response via getReleaseIds', async () => {
      repo.findById.mockResolvedValue(mockMilestone());
      repo.getReleaseIds.mockResolvedValue(['rel-1', 'rel-2']);

      const result = await service.updateMilestone(actor, 'ms-1', { name: 'Renamed' });
      expect(result.releaseIds).toEqual(['rel-1', 'rel-2']);
    });

    it('throws NotFoundException when milestone not found', async () => {
      repo.findById.mockResolvedValue(null);
      await expect(service.updateMilestone(actor, 'bad', { name: 'X' })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('persists manual target dates on update when no releases linked', async () => {
      repo.findById.mockResolvedValue(mockMilestone());
      repo.getReleaseIds.mockResolvedValue([]);

      await service.updateMilestone(actor, 'ms-1', {
        targetStartDate: '2024-03-01',
        targetEndDate: '2024-11-30',
      });

      // No linked Release → dates are NOT stripped; they reach repo.update and
      // recalcTargetDates (no-op when unlinked) leaves them in place.
      expect(repo.update).toHaveBeenCalledWith(
        'ms-1',
        expect.objectContaining({
          targetStartDate: '2024-03-01',
          targetEndDate: '2024-11-30',
        }),
      );
    });

    it('persists manual dates to repo but re-derives when releases linked', async () => {
      repo.findById.mockResolvedValue(mockMilestone());
      repo.getReleaseIds.mockResolvedValue(['rel-new']);
      db.select.mockReturnValue(makeChain([{ id: 'rel-new' }]));

      await service.updateMilestone(actor, 'ms-1', {
        targetStartDate: '2024-03-01',
        targetEndDate: '2024-11-30',
        releaseIds: ['rel-new'],
      });

      // Manual dates are not stripped (reach repo.update); recalcTargetDates then
      // overrides them with the derived Release window.
      expect(repo.setReleaseLinks).toHaveBeenCalledWith('ms-1', ['rel-new']);
      expect(repo.update).toHaveBeenCalledWith(
        'ms-1',
        expect.objectContaining({ targetStartDate: '2024-03-01' }),
      );
    });
  });

  // ── setMilestoneArtifacts ──────────────────────────────────────────────────

  describe('setMilestoneArtifacts', () => {
    /**
     * The write resolves each id from BOTH tables (`Promise.all`, work items first, portfolio items
     * second) and derives `entity_type` from where it was found — so the mock has to answer the two
     * `select()` calls differently, in that order. `makeDb` serves one result to every call, which is
     * exactly why a single `mockReturnValue` here would make every test see its rows twice and fail
     * the `resolved.length !== uniqueIds.length` check for the wrong reason.
     */
    const resolveAs = (work: unknown[], portfolio: unknown[]) => {
      db.select.mockReturnValueOnce(makeChain(work)).mockReturnValueOnce(makeChain(portfolio));
    };
    const story = { id: 'wi-1', projectId: 'proj-1', teamId: null, type: 'story' };
    const feature = { id: 'pi-1', projectId: 'proj-1', teamId: 'team-a', type: 'feature' };
    const epic = { id: 'pi-2', projectId: 'proj-1', teamId: null, type: 'epic' };

    it('assigns story/defect items within the milestone project scope', async () => {
      repo.findById.mockResolvedValue(mockMilestone({ projectId: 'proj-1' }));
      resolveAs([story], []);
      await service.setMilestoneArtifacts(actor, 'ms-1', ['wi-1']);
      expect(repo.setArtifactLinks).toHaveBeenCalledWith('ms-1', [
        { entityType: 'work_item', entityId: 'wi-1' },
      ]);
    });

    /**
     * FR-014 (SRS:49) and §116: "Valid direct artifact types are Story, Defect, Feature and Epic."
     *
     * These two used to be REFUSALS — `assertArtifactsInMilestoneScope` allowed story/defect only and
     * the payload was named `workItemIds`, so a Feature could be assigned from the Feature detail rail
     * (which writes the identical `entity_type = 'portfolio_item'` row) and never from the Milestone
     * end. The `entityType` in each expectation is the point: it is DERIVED from the table the id
     * resolved from, never sent by the caller.
     */
    it('assigns a FEATURE, as a portfolio_item link (FR-014)', async () => {
      repo.findById.mockResolvedValue(mockMilestone({ projectId: 'proj-1' }));
      resolveAs([], [feature]);
      await service.setMilestoneArtifacts(actor, 'ms-1', ['pi-1']);
      expect(repo.setArtifactLinks).toHaveBeenCalledWith('ms-1', [
        { entityType: 'portfolio_item', entityId: 'pi-1' },
      ]);
    });

    it('assigns an EPIC (FR-014)', async () => {
      repo.findById.mockResolvedValue(mockMilestone({ projectId: 'proj-1' }));
      resolveAs([], [epic]);
      await service.setMilestoneArtifacts(actor, 'ms-1', ['pi-2']);
      expect(repo.setArtifactLinks).toHaveBeenCalledWith('ms-1', [
        { entityType: 'portfolio_item', entityId: 'pi-2' },
      ]);
    });

    it('assigns a MIXED set in one replace, each id typed by its own table', async () => {
      repo.findById.mockResolvedValue(mockMilestone({ projectId: 'proj-1' }));
      resolveAs([story], [feature, epic]);
      await service.setMilestoneArtifacts(actor, 'ms-1', ['wi-1', 'pi-1', 'pi-2']);
      expect(repo.setArtifactLinks).toHaveBeenCalledWith('ms-1', [
        { entityType: 'work_item', entityId: 'wi-1' },
        { entityType: 'portfolio_item', entityId: 'pi-1' },
        { entityType: 'portfolio_item', entityId: 'pi-2' },
      ]);
    });

    it('CLEARS the whole direct set on an empty payload, both entity types', async () => {
      // §133: the payload "replaces the directly assigned Milestone artifact list". The delete used
      // to be scoped to `entity_type = 'work_item'`, so `[]` could not remove a Feature link at all.
      repo.findById.mockResolvedValue(mockMilestone({ projectId: 'proj-1' }));
      await service.setMilestoneArtifacts(actor, 'ms-1', []);
      expect(repo.setArtifactLinks).toHaveBeenCalledWith('ms-1', []);
      // Nothing to resolve, so nothing is queried.
      expect(db.select).not.toHaveBeenCalled();
    });

    it('rejects a TASK, which §116 excludes', async () => {
      repo.findById.mockResolvedValue(mockMilestone({ projectId: 'proj-1' }));
      resolveAs([{ ...story, type: 'task' }], []);
      await expect(service.setMilestoneArtifacts(actor, 'ms-1', ['wi-1'])).rejects.toMatchObject({
        code: 'MILESTONE_INVALID_ARTIFACT_TYPE',
      });
      expect(repo.setArtifactLinks).not.toHaveBeenCalled();
    });

    it('rejects an item outside the milestone project scope (FR-023)', async () => {
      repo.findById.mockResolvedValue(mockMilestone({ projectId: 'proj-1' }));
      resolveAs([{ ...story, projectId: 'proj-9' }], []);
      await expect(service.setMilestoneArtifacts(actor, 'ms-1', ['wi-1'])).rejects.toThrow(
        PreconditionFailedException,
      );
      expect(repo.setArtifactLinks).not.toHaveBeenCalled();
    });

    it('accepts an artifact in an ADDITIONALLY linked project (SRS:88, Q06)', async () => {
      // The `milestone_projects` union, from the MILESTONE end. It always held here; the point of the
      // test is that the portfolio-item patch path now shares this exact rule.
      repo.findById.mockResolvedValue(
        mockMilestone({ projectId: 'proj-9', projectIds: ['proj-1'] }),
      );
      resolveAs([], [feature]);
      await service.setMilestoneArtifacts(actor, 'ms-1', ['pi-1']);
      expect(repo.setArtifactLinks).toHaveBeenCalled();
    });

    it('refuses the whole write when an id resolves in NEITHER table', async () => {
      // A replace-SET is refused whole: a partially applied one would unlink everything the caller
      // could not name. Reported as a scope mismatch because an unresolvable id and an out-of-scope
      // one are indistinguishable from here.
      repo.findById.mockResolvedValue(mockMilestone({ projectId: 'proj-1' }));
      resolveAs([story], []);
      await expect(
        service.setMilestoneArtifacts(actor, 'ms-1', ['wi-1', 'ghost']),
      ).rejects.toMatchObject({ code: 'MILESTONE_PROJECT_MISMATCH' });
      expect(repo.setArtifactLinks).not.toHaveBeenCalled();
    });
  });

  // ── listMilestoneArtifacts — the DASHBOARD read (P3-MS-FR-019/020) ─────────
  //
  // Separate from `getMilestoneArtifacts` (which answers with link IDS) because the two shapes used
  // to share one route: the SPA read `{ data, pageInfo }` off a bare `string[]`, got `undefined` for
  // both, and every Milestone Artifacts tab rendered its empty state — including the seeded `MS-1`,
  // which has a linked story. The empty state is a legitimate answer, so nothing looked wrong.

  describe('listMilestoneArtifacts', () => {
    const row = {
      id: 'wi-1',
      itemKey: 'US-1',
      type: 'story',
      title: 'Upgrade the platform',
      scheduleState: 'defined',
      priority: 'high',
      assigneeId: 'user-1',
      assigneeName: 'Dev One',
      storyPoints: 5,
      createdAt: now,
      updatedAt: now,
    };

    /**
     * The PORTFOLIO half of the same polymorphic link table (`GAP-P3-MS-002`). `entity_type` has
     * been `work_item | portfolio_item` since migration 0084 and the Feature/Epic detail rail writes
     * the second kind, so an assigned Feature persisted and displayed on the Feature while this feed
     * hardcoded `'work_item'` and reported it as absent.
     */
    const featureRow = {
      id: 'pi-1',
      itemKey: 'FE-6',
      type: 'feature',
      title: 'Guest checkout',
      // Absent, not blank: a Feature carries no Schedule State and no priority column exists at all.
      scheduleState: '',
      priority: '',
      assigneeId: 'user-2',
      assigneeName: 'Owner Two',
      storyPoints: null,
      createdAt: now,
      updatedAt: now,
    };

    it('returns work items AND portfolio items as dashboard ROWS, with the summed total', async () => {
      // FOUR selects, in the order the `Promise.all` array evaluates: the work-item page (direct
      // links plus the inherited descendants of a linked Feature/Epic), the portfolio page, then a
      // COUNT for each. `makeDb` serves one result to every call, so the order is pinned here.
      db.select
        .mockReturnValueOnce(makeChain([{ ...row, sortKey: '20260101000000000001' }]))
        .mockReturnValueOnce(makeChain([{ ...featureRow, sortKey: '20260101000000000002' }]))
        .mockReturnValueOnce(makeChain([{ total: 1 }]))
        .mockReturnValueOnce(makeChain([{ total: 1 }]));

      const page = await service.listMilestoneArtifacts(actor, 'ms-1', { limit: 25, cursor: null });

      // Newest-first on the exact MICROSECOND key, not on the JS `Date` — both fixtures share one
      // `now`, so a millisecond comparison would tie and order them by id instead.
      expect(page.data).toEqual([featureRow, row]);
      // Summed across both branches, and the sort key never reaches the response.
      expect(page.pageInfo.total).toBe(2);
      expect(page.pageInfo.hasNextPage).toBe(false);
    });

    /**
     * FR-029 (SRS:64): "Directly assigning an Epic includes its child Features and their Story/Defect
     * descendants." Restated at §117 and AC-8 (§165).
     *
     * The Story/Defect half was present — the work-item branch has always matched
     * `feature_id in (direct portfolio items OR their children)` — and the FEATURE half was not: the
     * portfolio branch's predicate was `id in <direct links>` alone, so an assigned Epic's child
     * Features never became artifact rows while their leaf Stories did. On screen that is leaf work
     * with no parent row to explain where it came from.
     *
     * Asserted on the emitted PREDICATE rather than on rows, because the fixture rows come from the
     * mock and would prove nothing about the SQL. `parent_id` appearing in the portfolio branch is the
     * change; reverting it makes only the second expectation fail, which is what makes this
     * non-vacuous.
     */
    it('reaches an assigned Epic’s child Features in the PORTFOLIO branch too (FR-029)', async () => {
      const workPage = makeChain([]);
      const portfolioPage = makeChain([]);
      db.select
        .mockReturnValueOnce(workPage)
        .mockReturnValueOnce(portfolioPage)
        .mockReturnValueOnce(makeChain([{ total: 0 }]))
        .mockReturnValueOnce(makeChain([{ total: 0 }]));

      await service.listMilestoneArtifacts(actor, 'ms-1', { limit: 25, cursor: null });

      const workSql = whereSql(workPage);
      const portfolioSql = whereSql(portfolioPage);
      // Both branches read the SAME set: direct Epics/Features plus the children of a direct Epic.
      expect(workSql).toContain('parent_id');
      expect(portfolioSql).toContain('parent_id');
      // And the set is still archive-aware and workspace-scoped, so a child Feature cannot arrive
      // through a predicate that dropped either.
      expect(portfolioSql).toContain('archived_at is null');
      expect(portfolioSql).toContain('workspace_id');
    });

    it('loads the milestone first, so an unknown id is a 404 and not an empty page', async () => {
      // Route-level `milestone:view` resolves the project from `:id`; this read additionally proves
      // the row exists in the actor's workspace, which is what stops a cross-workspace id from
      // answering "this milestone has no artifacts".
      repo.findById.mockResolvedValue(null);
      await expect(
        service.listMilestoneArtifacts(actor, 'ms-1', { limit: 25, cursor: null }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── assertArtifactsAssignable — the WORK-ITEM side of the same link ────────
  //
  // `PUT /work-items/:id/milestones` writes these rows too and used to apply only its own
  // project check, so a Task or an out-of-team item became an artifact through that endpoint
  // while this one refused it. Both call the rule below now (P23-07).

  describe('assertArtifactsAssignable', () => {
    const story = { projectId: 'proj-1', teamId: 'team-a', type: 'story' };

    it('accepts an item in the owning project', async () => {
      repo.findById.mockResolvedValue(mockMilestone({ projectId: 'proj-1' }));
      await expect(
        service.assertArtifactsAssignable('ws-1', ['ms-1'], [story]),
      ).resolves.toBeUndefined();
    });

    it('accepts an item in an ADDITIONALLY linked project (SRS §5.2 / FR-021)', async () => {
      // `findById` resolves the link tables itself, so the scope rides on the milestone.
      repo.findById.mockResolvedValue(
        mockMilestone({ projectId: 'proj-9', projectIds: ['proj-1'] }),
      );
      await expect(
        service.assertArtifactsAssignable('ws-1', ['ms-1'], [story]),
      ).resolves.toBeUndefined();
    });

    it('rejects a TASK (SRS §5.1 / FR-014)', async () => {
      repo.findById.mockResolvedValue(mockMilestone({ projectId: 'proj-1' }));
      await expect(
        service.assertArtifactsAssignable('ws-1', ['ms-1'], [{ ...story, type: 'task' }]),
      ).rejects.toMatchObject({ code: 'MILESTONE_INVALID_ARTIFACT_TYPE' });
    });

    it('rejects an item outside a selected Team scope', async () => {
      repo.findById.mockResolvedValue(mockMilestone({ projectId: 'proj-1', teamIds: ['team-b'] }));
      await expect(
        service.assertArtifactsAssignable('ws-1', ['ms-1'], [story]),
      ).rejects.toMatchObject({ code: 'MILESTONE_TEAM_MISMATCH' });
    });

    it('rejects a team-AGNOSTIC item against a Team-scoped milestone', async () => {
      repo.findById.mockResolvedValue(mockMilestone({ projectId: 'proj-1', teamIds: ['team-a'] }));
      await expect(
        service.assertArtifactsAssignable('ws-1', ['ms-1'], [{ ...story, teamId: null }]),
      ).rejects.toMatchObject({ code: 'MILESTONE_TEAM_MISMATCH' });
    });

    it('accepts a FEATURE and an EPIC (FR-014, §116)', async () => {
      repo.findById.mockResolvedValue(mockMilestone({ projectId: 'proj-1' }));
      await expect(
        service.assertArtifactsAssignable(
          'ws-1',
          ['ms-1'],
          [
            { ...story, type: 'feature' },
            { ...story, type: 'epic' },
          ],
        ),
      ).resolves.toBeUndefined();
    });

    /**
     * The EPIC team-scope exemption — a DECLARED READING, and the pair of tests is the whole of it.
     *
     * An Epic has no `team_id` (`ck_portfolio_epic_shape`; §11.1 "Epic is stored at Project level. It
     * has no Team field"), so the "team-agnostic is OUT of a team scope" rule above cannot apply to
     * it: `null` there is the absence of the dimension, not an unset value. Filtering anyway would
     * refuse EVERY Epic on every team-scoped Milestone, making FR-014's Epic support unreachable for
     * those Milestones. A FEATURE has the column, so it is NOT exempt.
     */
    it('exempts an EPIC from a selected Team scope, because it cannot carry a team', async () => {
      repo.findById.mockResolvedValue(mockMilestone({ projectId: 'proj-1', teamIds: ['team-a'] }));
      await expect(
        service.assertArtifactsAssignable(
          'ws-1',
          ['ms-1'],
          [{ projectId: 'proj-1', teamId: null, type: 'epic' }],
        ),
      ).resolves.toBeUndefined();
    });

    it('does NOT exempt a Feature with no team from a selected Team scope', async () => {
      repo.findById.mockResolvedValue(mockMilestone({ projectId: 'proj-1', teamIds: ['team-a'] }));
      await expect(
        service.assertArtifactsAssignable(
          'ws-1',
          ['ms-1'],
          [{ projectId: 'proj-1', teamId: null, type: 'feature' }],
        ),
      ).rejects.toMatchObject({ code: 'MILESTONE_TEAM_MISMATCH' });
    });

    it('rejects a milestone in another workspace', async () => {
      repo.findById.mockResolvedValue(mockMilestone({ workspaceId: 'ws-other' }));
      await expect(service.assertArtifactsAssignable('ws-1', ['ms-1'], [story])).rejects.toThrow(
        NotFoundException,
      );
    });

    it('checks EVERY milestone in the set, not just the first', async () => {
      repo.findById.mockImplementation((id: string) =>
        Promise.resolve(mockMilestone({ id, projectId: id === 'ms-2' ? 'proj-9' : 'proj-1' })),
      );
      await expect(
        service.assertArtifactsAssignable('ws-1', ['ms-1', 'ms-2'], [story]),
      ).rejects.toMatchObject({ code: 'MILESTONE_PROJECT_MISMATCH' });
    });
  });

  // ── status transitions (relaxed graph — completed is terminal) ─────────────

  describe('status transitions', () => {
    it('allows a relaxed transition that the old graph forbade (planned → met)', async () => {
      repo.findById.mockResolvedValue(mockMilestone({ status: 'planned' }));
      await expect(
        service.updateMilestone(actor, 'ms-1', { status: 'met' }),
      ).resolves.toBeDefined();
      expect(repo.update).toHaveBeenCalled();
    });

    it('allows re-opening from a non-terminal state (cancelled → planned)', async () => {
      repo.findById.mockResolvedValue(mockMilestone({ status: 'cancelled' }));
      await expect(
        service.updateMilestone(actor, 'ms-1', { status: 'planned' }),
      ).resolves.toBeDefined();
    });

    it('rejects reopening a completed milestone (terminal)', async () => {
      repo.findById.mockResolvedValue(mockMilestone({ status: 'completed' }));
      await expect(service.updateMilestone(actor, 'ms-1', { status: 'planned' })).rejects.toThrow(
        PreconditionFailedException,
      );
      expect(repo.update).not.toHaveBeenCalled();
    });
  });

  // ── cross-workspace link guard (tenant isolation) ──────────────────────────

  describe('cross-workspace link guard', () => {
    it('rejects a release from another workspace on create', async () => {
      db.select.mockReturnValue(makeChain([])); // no rows match → foreign / missing
      await expect(
        service.createMilestone(actor, 'proj-1', 'MVP', { releaseIds: ['rel-x'] }),
      ).rejects.toThrow(PreconditionFailedException);
      expect(repo.setReleaseLinks).not.toHaveBeenCalled();
    });

    it('rejects a linked project from another workspace on create', async () => {
      db.select.mockReturnValue(makeChain([]));
      await expect(
        service.createMilestone(actor, 'proj-1', 'MVP', { projectIds: ['proj-x'] }),
      ).rejects.toThrow(PreconditionFailedException);
      expect(repo.setProjectLinks).not.toHaveBeenCalled();
    });

    it('rejects a linked team from another workspace on create', async () => {
      db.select.mockReturnValue(makeChain([]));
      await expect(
        service.createMilestone(actor, 'proj-1', 'MVP', { teamIds: ['team-x'] }),
      ).rejects.toThrow(PreconditionFailedException);
      expect(repo.setTeamLinks).not.toHaveBeenCalled();
    });

    it('rejects a foreign project on update', async () => {
      repo.findById.mockResolvedValue(mockMilestone());
      db.select.mockReturnValue(makeChain([]));
      await expect(
        service.updateMilestone(actor, 'ms-1', { projectIds: ['proj-x'] }),
      ).rejects.toThrow(PreconditionFailedException);
      expect(repo.setProjectLinks).not.toHaveBeenCalled();
    });

    it('rejects a foreign project on setMilestoneProjects', async () => {
      repo.findById.mockResolvedValue(mockMilestone());
      db.select.mockReturnValue(makeChain([]));
      await expect(service.setMilestoneProjects(actor, 'ms-1', ['proj-x'])).rejects.toThrow(
        PreconditionFailedException,
      );
      expect(repo.setProjectLinks).not.toHaveBeenCalled();
    });

    it('accepts in-workspace projects on setMilestoneProjects', async () => {
      repo.findById.mockResolvedValue(mockMilestone());
      db.select.mockReturnValue(makeChain([{ id: 'proj-2' }]));
      await service.setMilestoneProjects(actor, 'ms-1', ['proj-2']);
      expect(repo.setProjectLinks).toHaveBeenCalledWith('ms-1', ['proj-2']);
    });

    it('rejects a foreign team on setMilestoneTeams', async () => {
      repo.findById.mockResolvedValue(mockMilestone());
      db.select.mockReturnValue(makeChain([]));
      await expect(service.setMilestoneTeams(actor, 'ms-1', ['team-x'])).rejects.toThrow(
        PreconditionFailedException,
      );
      expect(repo.setTeamLinks).not.toHaveBeenCalled();
    });

    it('accepts in-workspace teams on setMilestoneTeams', async () => {
      repo.findById.mockResolvedValue(mockMilestone());
      db.select.mockReturnValue(makeChain([{ id: 'team-2' }]));
      await service.setMilestoneTeams(actor, 'ms-1', ['team-2']);
      expect(repo.setTeamLinks).toHaveBeenCalledWith('ms-1', ['team-2']);
    });
  });

  // ── deleteMilestone ──────────────────────────────────────────────────────

  describe('deleteMilestone', () => {
    it('deletes the milestone (link rows drop via DB cascade)', async () => {
      repo.findById.mockResolvedValue(mockMilestone());
      await service.deleteMilestone(actor, 'ms-1');

      expect(repo.delete).toHaveBeenCalledWith('ms-1');
    });

    // Authorization (milestone:delete) enforced by the PolicyGuard at the route (P2).

    it('throws when milestone not found', async () => {
      repo.findById.mockResolvedValue(null);
      await expect(service.deleteMilestone(actor, 'bad')).rejects.toThrow(NotFoundException);
    });
  });

  /**
   * PRJ-03. Create, update and delete carried `assertProjectWritable`; the four replace-SET writes
   * did not, so an archived project's milestones kept their artifacts, Projects, Teams and Releases
   * fully editable — and `setMilestoneReleases` additionally rewrites the milestone's own target
   * window, which FR-011/012 derive from the linked releases.
   *
   * `assertArtifactsAssignable` is included because `milestone_artifacts` has TWO write paths and
   * they must enforce the same set of rules. It is the milestone half of
   * `PUT /work-items/:id/milestones`: `WorkItemsService` checks the WORK ITEM's project, this
   * checks the MILESTONE's, and the two genuinely differ — a milestone's artifact scope spans
   * `milestone_projects`. Without it, the row `setMilestoneArtifacts` refuses could be written from
   * the other end, which is exactly the asymmetry that method's docblock was written about.
   */
  describe('an archived project refuses the link-set writes (PRJ-FR-010)', () => {
    beforeEach(() => {
      repo.findById.mockResolvedValue(mockMilestone());
      projects.assertProjectWritable.mockRejectedValue(
        new PreconditionFailedException('PROJECT_ARCHIVED', 'archived'),
      );
    });

    it('refuses an artifact set', async () => {
      await expect(service.setMilestoneArtifacts(actor, 'ms-1', ['wi-1'])).rejects.toMatchObject({
        code: 'PROJECT_ARCHIVED',
      });
      expect(repo.setArtifactLinks).not.toHaveBeenCalled();
    });

    it('refuses a project set', async () => {
      await expect(service.setMilestoneProjects(actor, 'ms-1', ['proj-2'])).rejects.toMatchObject({
        code: 'PROJECT_ARCHIVED',
      });
      expect(repo.setProjectLinks).not.toHaveBeenCalled();
    });

    it('refuses a team set', async () => {
      await expect(service.setMilestoneTeams(actor, 'ms-1', ['team-1'])).rejects.toMatchObject({
        code: 'PROJECT_ARCHIVED',
      });
      expect(repo.setTeamLinks).not.toHaveBeenCalled();
    });

    it('refuses a release set, which would also rewrite the target window', async () => {
      await expect(service.setMilestoneReleases(actor, 'ms-1', ['rel-1'])).rejects.toMatchObject({
        code: 'PROJECT_ARCHIVED',
      });
      expect(repo.setReleaseLinks).not.toHaveBeenCalled();
    });

    it('refuses the WORK-ITEM side of the same artifact link', async () => {
      await expect(
        service.assertArtifactsAssignable(
          'ws-1',
          ['ms-1'],
          [{ projectId: 'proj-1', teamId: null, type: 'story' }],
        ),
      ).rejects.toMatchObject({ code: 'PROJECT_ARCHIVED' });
    });

    it('still READS its links — archived is read-only, not invisible', async () => {
      await expect(service.getMilestoneArtifacts(actor, 'ms-1')).resolves.toEqual([]);
      await expect(service.getMilestoneReleases(actor, 'ms-1')).resolves.toEqual([]);
    });
  });
  /**
   * §5.2:134 — "Each artifact must be accessible to the current user", and the same question for a
   * project being pulled into a milestone's scope.
   *
   * None of this was checked: the writes validated WORKSPACE residency and the milestone's project
   * scope, never the caller's own access. So `milestone:edit` on one project was enough to link
   * another project, attach its rows, and read their key/title/state/owner/points back through
   * `GET /milestones/:id/artifacts/items` — a route gated on the FIRST project.
   *
   * Asserted at the service, deliberately: the checks live here, not in a decorator, so this is the
   * layer that can see them. The route-level half (`PUT /work-items/:id/milestones`, previously
   * writable by an Editor) is `assertMayAssignMilestones`, also a service call — see below.
   */
  describe('the caller must be able to see what they link (§5.2:134)', () => {
    const resolveAs = (work: unknown[], portfolio: unknown[]) => {
      db.select.mockReturnValueOnce(makeChain(work)).mockReturnValueOnce(makeChain(portfolio));
    };

    it('REFUSES an artifact whose own project the caller cannot read', async () => {
      repo.findById.mockResolvedValue(mockMilestone({ projectId: 'proj-1' }));
      resolveAs([{ id: 'wi-9', projectId: 'proj-2', teamId: null, type: 'story' }], []);
      access.assertProjectPermission.mockRejectedValueOnce(new Error('denied'));

      await expect(service.setMilestoneArtifacts(actor, 'ms-1', ['wi-9'])).rejects.toThrow(
        'denied',
      );
      expect(repo.setArtifactLinks).not.toHaveBeenCalled();
    });

    it('asks per TABLE — work_item:view for a Story, portfolio:view for a Feature', async () => {
      // Not one question for both: `work_item:view` is an Editor code and `portfolio:view` is not
      // (§3.2:82 hides Portfolio from an Editor), so a single code would over-refuse the Story or
      // under-refuse the Feature. The codes match those surfaces' own read gates.
      repo.findById.mockResolvedValue(mockMilestone({ projectId: 'proj-1' }));
      resolveAs(
        [{ id: 'wi-1', projectId: 'proj-1', teamId: null, type: 'story' }],
        [{ id: 'pi-1', projectId: 'proj-1', teamId: null, type: 'feature' }],
      );

      await service.setMilestoneArtifacts(actor, 'ms-1', ['wi-1', 'pi-1']);

      const codes = access.assertProjectPermission.mock.calls.map((c) => String(c[2]));
      expect(codes).toContain('work_item:view');
      expect(codes).toContain('portfolio:view');
    });

    it('REFUSES widening a milestone into a project the caller cannot read', async () => {
      repo.findById.mockResolvedValue(mockMilestone({ projectId: 'proj-1' }));
      // Workspace residency passes — the point is that residency alone was the ONLY check.
      db.select.mockReturnValue(makeChain([{ id: 'proj-2' }]));
      access.assertProjectPermission.mockRejectedValueOnce(new Error('denied'));

      await expect(service.setMilestoneProjects(actor, 'ms-1', ['proj-2'])).rejects.toThrow(
        'denied',
      );
      expect(repo.setProjectLinks).not.toHaveBeenCalled();
    });

    it('does not re-ask for projects the milestone ALREADY reaches', async () => {
      // A milestone may legitimately span projects (FR-008 §43, §70/§74, Q06 §149). The rule is "you
      // may only WIDEN it into projects you can reach", so an existing link is not re-judged — that
      // would make a milestone uneditable by anyone who has since lost access to one of its projects.
      repo.findById.mockResolvedValue(mockMilestone({ projectId: 'proj-1' }));
      repo.getProjectIds.mockResolvedValue(['proj-2']);
      db.select.mockReturnValue(makeChain([{ id: 'proj-2' }]));

      await service.setMilestoneProjects(actor, 'ms-1', ['proj-2']);

      const asked = access.assertProjectPermission.mock.calls.map((c) => String(c[1]));
      expect(asked).not.toContain('proj-2');
    });

    it('assertMayAssignMilestones asks for milestone:view — the code §3.2:80 withholds from an Editor', async () => {
      // The other half of the row: `PUT /work-items/:id/milestones` carried only `work_item:edit`,
      // which an Editor holds, while §3.2:80 puts "Releases AND Milestones" Hidden for them. The
      // Release half was already refused this way (`assertMayAssignRelease`); this is its mirror.
      await service.assertMayAssignMilestones(actor, 'proj-1');
      expect(access.assertProjectPermission).toHaveBeenCalledWith(
        actor,
        'proj-1',
        'milestone:view',
      );
    });
  });
});
