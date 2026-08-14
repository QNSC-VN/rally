import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { DRIZZLE, NotFoundException, PreconditionFailedException } from '@platform';
import { ProjectsService } from '@modules/projects';
import { WorkItemsService } from '@modules/work-items';
import { AccessService } from '@modules/access';
import { IterationsService } from './iterations.service';
import { ITERATION_REPOSITORY } from '../domain/ports/iteration.repository';
import { ActivityLogger } from '@modules/activity';
import type { Iteration } from '../domain/iteration.types';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const now = new Date('2024-06-01');

const mockIteration = (o: Partial<Iteration> = {}): Iteration => ({
  id: 'it-1',
  workspaceId: 'ws-1',
  projectId: 'proj-1',
  teamId: null,
  iterationKey: 'IT-1',
  name: 'Sprint 24.3',
  goal: null,
  theme: null,
  notes: null,
  state: 'planning',
  plannedVelocity: null,
  startDate: '2024-06-01',
  endDate: '2024-06-14',
  completedAt: null,
  createdAt: now,
  updatedAt: now,
  ...o,
});

const actor = { sub: 'user-1', workspaceId: 'ws-1' } as never;

describe('IterationsService', () => {
  let service: IterationsService;
  let repo: {
    findById: ReturnType<typeof vi.fn>;
    listByProject: ReturnType<typeof vi.fn>;
    taskEstimatesByIteration: ReturnType<typeof vi.fn>;
    listAssignmentOptions: ReturnType<typeof vi.fn>;
    listReferences: ReturnType<typeof vi.fn>;
    nextKeyNumber: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
  let projects: {
    getProject: ReturnType<typeof vi.fn>;
    assertProjectWritable: ReturnType<typeof vi.fn>;
    listProjectTeams: ReturnType<typeof vi.fn>;
    assertTeamLinkedToProject: ReturnType<typeof vi.fn>;
  };
  let access: { assertProjectPermission: ReturnType<typeof vi.fn> };
  let workItemsSvc: { updateWorkItem: ReturnType<typeof vi.fn> };
  // Chainable Drizzle mock. Tests set the resolved rows before invoking.
  let dbSelectResult: unknown[];
  let dbUpdateReturning: unknown[];
  let db: {
    select: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    dbSelectResult = [];
    dbUpdateReturning = [];
    db = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({ where: vi.fn(() => Promise.resolve(dbSelectResult)) })),
      })),
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(() => ({ returning: vi.fn(() => Promise.resolve(dbUpdateReturning)) })),
        })),
      })),
    };
    repo = {
      findById: vi.fn(),
      listByProject: vi.fn(),
      taskEstimatesByIteration: vi.fn().mockResolvedValue(new Map()),
      listAssignmentOptions: vi.fn().mockResolvedValue([]),
      listReferences: vi.fn().mockResolvedValue([]),
      nextKeyNumber: vi.fn().mockResolvedValue(1),
      create: vi.fn().mockImplementation((i) => Promise.resolve(mockIteration(i))),
      update: vi
        .fn()
        .mockImplementation((id, patch) => Promise.resolve(mockIteration({ id, ...patch }))),
      delete: vi.fn().mockResolvedValue(undefined),
    };
    workItemsSvc = { updateWorkItem: vi.fn().mockResolvedValue({}) };
    projects = {
      getProject: vi.fn().mockResolvedValue({ id: 'proj-1' }),
      assertProjectWritable: vi.fn().mockResolvedValue(undefined),
      listProjectTeams: vi.fn().mockResolvedValue([{ teamId: 'team-1', status: 'active' }]),
      assertTeamLinkedToProject: vi.fn(),
    };
    // Mirror the real ProjectsService rule so tests keep driving the outcome via
    // the listProjectTeams mock.
    projects.assertTeamLinkedToProject.mockImplementation(
      async (ws: string, projectId: string, teamId: string) => {
        const listProjectTeams = projects.listProjectTeams as unknown as (
          ws: string,
          projectId: string,
        ) => Promise<Array<{ teamId: string; status: string }>>;
        const links = await listProjectTeams(ws, projectId);
        if (!links.some((l) => l.teamId === teamId && l.status === 'active')) {
          throw new PreconditionFailedException(
            'PROJECT_TEAM_LINK_NOT_FOUND',
            'Team is not linked to this project',
          );
        }
      },
    );
    access = { assertProjectPermission: vi.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IterationsService,
        { provide: ITERATION_REPOSITORY, useValue: repo },
        {
          provide: ActivityLogger,
          useValue: {
            build: vi.fn(() => ({})),
            buildDiff: vi.fn(() => []),
            log: vi.fn().mockResolvedValue(undefined),
            logSafe: vi.fn().mockResolvedValue(undefined),
            listFor: vi.fn().mockResolvedValue({ data: [], total: 0, page: 1, pageSize: 50 }),
          },
        },
        { provide: ProjectsService, useValue: projects },
        { provide: AccessService, useValue: access },
        // Rollover moves items through the ordinary work-item write path rather than a bulk
        // `db.update`, so the real invariants (team match, auto-accept, activity) apply. The mock is
        // what lets this spec assert the DELEGATION; the behaviour behind it is covered where it
        // lives, in the work-items service and in `derived-invariants.e2e.spec.ts`.
        { provide: WorkItemsService, useValue: workItemsSvc },
        { provide: DRIZZLE, useValue: db },
      ],
    }).compile();

    service = module.get(IterationsService);
  });

  describe('getAssignmentOptions', () => {
    it('validates project exists then delegates to repo', async () => {
      const opts = [mockIteration({ id: 'it-2', state: 'committed' })];
      repo.listAssignmentOptions.mockResolvedValue(opts);

      const result = await service.getAssignmentOptions(actor, 'proj-1', 'team-1');

      expect(projects.getProject).toHaveBeenCalledWith('ws-1', 'proj-1');
      expect(repo.listAssignmentOptions).toHaveBeenCalledWith('proj-1', 'ws-1', 'team-1');
      expect(result).toEqual(opts);
    });

    it('propagates project-not-found when project does not exist', async () => {
      projects.getProject.mockRejectedValue(new Error('PROJECT_NOT_FOUND'));
      await expect(service.getAssignmentOptions(actor, 'bad-proj')).rejects.toThrow(
        'PROJECT_NOT_FOUND',
      );
      expect(repo.listAssignmentOptions).not.toHaveBeenCalled();
    });

    it('omits teamId from repo call when not provided', async () => {
      await service.getAssignmentOptions(actor, 'proj-1');
      expect(repo.listAssignmentOptions).toHaveBeenCalledWith('proj-1', 'ws-1', undefined);
    });
  });

  /**
   * The REFERENCE half of the feed split. Two feeds, two repository methods — deliberately not one
   * method with an `includeAllStates` flag, because the population is the whole difference between
   * "what may I assign into" and "what is this called".
   */
  describe('getIterationReferences', () => {
    it('validates project exists then delegates to the REFERENCE query', async () => {
      const refs = [{ id: 'it-9', name: 'Sprint 9', iterationKey: 'IT-9', state: 'accepted' }];
      repo.listReferences.mockResolvedValue(refs);

      const result = await service.getIterationReferences(actor, 'proj-1', 'team-1');

      expect(projects.getProject).toHaveBeenCalledWith('ws-1', 'proj-1');
      expect(repo.listReferences).toHaveBeenCalledWith('proj-1', 'ws-1', 'team-1');
      // And NOT the eligibility query: an accepted iteration must survive this call.
      expect(repo.listAssignmentOptions).not.toHaveBeenCalled();
      expect(result).toEqual(refs);
    });

    it('propagates project-not-found when project does not exist', async () => {
      projects.getProject.mockRejectedValue(new Error('PROJECT_NOT_FOUND'));
      await expect(service.getIterationReferences(actor, 'bad-proj')).rejects.toThrow(
        'PROJECT_NOT_FOUND',
      );
      expect(repo.listReferences).not.toHaveBeenCalled();
    });

    it('omits teamId from repo call when not provided', async () => {
      await service.getIterationReferences(actor, 'proj-1');
      expect(repo.listReferences).toHaveBeenCalledWith('proj-1', 'ws-1', undefined);
    });
  });

  describe('listIterations', () => {
    it('validates project access before listing', async () => {
      repo.listByProject.mockResolvedValue({
        data: [],
        pageInfo: { nextCursor: null, hasNextPage: false, limit: 25 },
      });
      await service.listIterations(actor, 'proj-1', {}, { limit: 25, cursor: null });
      expect(projects.getProject).toHaveBeenCalledWith('ws-1', 'proj-1');
    });

    it('propagates project-not-found to the caller', async () => {
      projects.getProject.mockRejectedValue(new Error('PROJECT_NOT_FOUND'));
      await expect(
        service.listIterations(actor, 'bad', {}, { limit: 25, cursor: null }),
      ).rejects.toThrow('PROJECT_NOT_FOUND');
    });
  });

  describe('updateIteration', () => {
    it('rejects changing teamId to a team not linked to the project', async () => {
      repo.findById.mockResolvedValue(mockIteration({ state: 'planning' }));
      projects.listProjectTeams.mockResolvedValue([{ teamId: 'other', status: 'active' }]);
      await expect(
        service.updateIteration(actor, 'it-1', { teamId: 'team-1' }),
      ).rejects.toBeInstanceOf(PreconditionFailedException);
    });

    it('rejects an updated date range where endDate is before startDate', async () => {
      repo.findById.mockResolvedValue(
        mockIteration({ state: 'planning', startDate: '2024-06-01', endDate: '2024-06-14' }),
      );
      await expect(
        service.updateIteration(actor, 'it-1', { endDate: '2024-05-01' }),
      ).rejects.toBeInstanceOf(PreconditionFailedException);
    });

    it('updates successfully when team is linked', async () => {
      repo.findById.mockResolvedValue(mockIteration({ state: 'planning' }));
      const updated = await service.updateIteration(actor, 'it-1', { name: 'Renamed' });
      expect(updated.name).toBe('Renamed');
    });
  });

  /**
   * P23-03, first half — the state machine against the BA's own state rules.
   *
   * The guard allowed exactly `planning → committed` and `committed → accepted` and refused the
   * other four with `ITERATION_INVALID_STATE_TRANSITION`. The P2 Iterations SRS (product-docs
   * `origin/main`) permits all six: §1 "User can manually change Iteration State at any time when
   * permitted", §10.1 "Iteration state remains user-editable according to permission" / "No
   * Iteration state locks scope by itself", and — the deciding sentence — §10.1 "If an item later
   * moves out of `Accepted`, system should not force a reverse status change; user manages Iteration
   * status manually", which is a manual reverse this code made unreachable.
   *
   * Both directions are asserted on purpose: a spec that only proves the refusals passes just as
   * well when the machine is over-tightened.
   */
  describe('the iteration state machine (BA §10.1: manual, at any time)', () => {
    const gateSatisfied = () => {
      dbSelectResult = [{ total: 2, allAccepted: true }];
    };

    it('planning → committed (the manual scope commitment, P2-IT-FR-023)', async () => {
      repo.findById.mockResolvedValue(mockIteration({ state: 'planning' }));
      await expect(
        service.updateIteration(actor, 'it-1', { state: 'committed' }),
      ).resolves.toMatchObject({ state: 'committed' });
    });

    it('planning → accepted — the AUTO rule already performs this pair', async () => {
      // `autoAcceptIterationIfComplete` selects `state IN ('planning','committed')`, so refusing it
      // manually made the user less capable than a convenience behaviour that "does not remove
      // manual status control" (§10.1).
      repo.findById.mockResolvedValue(mockIteration({ state: 'planning' }));
      gateSatisfied();
      await expect(
        service.updateIteration(actor, 'it-1', { state: 'accepted' }),
      ).resolves.toMatchObject({ state: 'accepted' });
    });

    it('committed → accepted', async () => {
      repo.findById.mockResolvedValue(mockIteration({ state: 'committed' }));
      gateSatisfied();
      await expect(
        service.updateIteration(actor, 'it-1', { state: 'accepted' }),
      ).resolves.toMatchObject({ state: 'accepted' });
    });

    it('committed → planning (un-commit — no state locks scope by itself)', async () => {
      repo.findById.mockResolvedValue(mockIteration({ state: 'committed' }));
      await expect(
        service.updateIteration(actor, 'it-1', { state: 'planning' }),
      ).resolves.toMatchObject({ state: 'planning' });
    });

    it('accepted → committed, and CLEARS the acceptance stamp', async () => {
      repo.findById.mockResolvedValue(
        mockIteration({ state: 'accepted', completedAt: new Date('2024-06-14') }),
      );
      const updated = await service.updateIteration(actor, 'it-1', { state: 'committed' });
      expect(updated.state).toBe('committed');
      expect(repo.update).toHaveBeenCalledWith('it-1', { state: 'committed', completedAt: null });
    });

    it('accepted → planning', async () => {
      repo.findById.mockResolvedValue(mockIteration({ state: 'accepted' }));
      await expect(
        service.updateIteration(actor, 'it-1', { state: 'planning' }),
      ).resolves.toMatchObject({ state: 'planning' });
    });

    it('still CONTENT-gates the accept — loosening the machine did not open the gate', async () => {
      repo.findById.mockResolvedValue(mockIteration({ state: 'planning' }));
      dbSelectResult = [{ total: 3, allAccepted: false }];
      await expect(
        service.updateIteration(actor, 'it-1', { state: 'accepted' }),
      ).rejects.toMatchObject({ code: 'ITERATION_NOT_ALL_ACCEPTED' });
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('resending the current state writes nothing (a PATCH of the whole form is a no-op)', async () => {
      repo.findById.mockResolvedValue(mockIteration({ state: 'committed' }));
      await expect(
        service.updateIteration(actor, 'it-1', { state: 'committed' }),
      ).resolves.toMatchObject({ state: 'committed' });
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('is ONE home, so the commit ROUTE answers a pair the same way the PATCH does', async () => {
      // `POST /:id/commit` demanded `planning` while the PATCH classified the same pair as a
      // reopen — two routes, one pair, two answers. Both now go through `applyStateChange`.
      repo.findById.mockResolvedValue(mockIteration({ state: 'accepted' }));
      await expect(service.commitIteration(actor, 'it-1')).resolves.toMatchObject({
        state: 'committed',
      });
    });

    it('refuses a no-op on the commit route rather than reporting a change', async () => {
      repo.findById.mockResolvedValue(mockIteration({ state: 'committed' }));
      await expect(service.commitIteration(actor, 'it-1')).rejects.toMatchObject({
        code: 'ITERATION_INVALID_STATE_TRANSITION',
      });
    });
  });

  describe('rolloverUnfinished', () => {
    it('rejects a carry-over target from a different project', async () => {
      repo.findById
        .mockResolvedValueOnce(mockIteration({ state: 'committed', projectId: 'proj-1' }))
        .mockResolvedValueOnce(mockIteration({ id: 'it-2', projectId: 'proj-2' }));
      await expect(
        service.rolloverUnfinished(actor, 'it-1', { moveToIterationId: 'it-2' }),
      ).rejects.toBeInstanceOf(PreconditionFailedException);
    });

    it('moves not-yet-accepted items and returns the moved count', async () => {
      repo.findById.mockResolvedValue(mockIteration({ state: 'committed' }));
      // Rollover uses the same D1 acceptance predicate as the accept-gate
      // (schedule_state ∉ {accepted, release}) — no workflow-status lookup.
      dbSelectResult = [{ id: 'wi-1' }, { id: 'wi-2' }];
      const res = await service.rolloverUnfinished(actor, 'it-1');
      expect(res).toEqual({ movedCount: 2 });
    });

    it('moves each item through the work-item write path, not a bulk UPDATE', async () => {
      /**
       * The regression this guards. Rollover used to be one `db.update(workItems)`, which skipped
       * every rule the ordinary assignment path applies: the iteration/team match
       * (`ITERATION_TEAM_MISMATCH`), the auto-accept re-evaluation that CLAUDE.md requires on
       * "every membership write … BOTH affected iterations", the activity entry, and an Editor's
       * team scoping. Asserting the DELEGATION is what keeps those from being lost again — a bulk
       * write would satisfy `movedCount` while satisfying none of them.
       */
      repo.findById.mockResolvedValue(mockIteration({ state: 'committed' }));
      dbSelectResult = [{ id: 'wi-1' }, { id: 'wi-2' }];

      await service.rolloverUnfinished(actor, 'it-1');

      expect(workItemsSvc.updateWorkItem).toHaveBeenCalledTimes(2);
      expect(workItemsSvc.updateWorkItem).toHaveBeenCalledWith(actor, 'wi-1', {
        iterationId: null,
      });
      // Nothing writes the column directly any more.
      expect(db.update).not.toHaveBeenCalled();
    });

    it('carries items INTO the target iteration when one is given', async () => {
      repo.findById
        .mockResolvedValueOnce(mockIteration({ state: 'committed', projectId: 'proj-1' }))
        .mockResolvedValueOnce(mockIteration({ id: 'it-2', projectId: 'proj-1' }));
      dbSelectResult = [{ id: 'wi-1' }];

      await service.rolloverUnfinished(actor, 'it-1', { moveToIterationId: 'it-2' });

      expect(workItemsSvc.updateWorkItem).toHaveBeenCalledWith(actor, 'wi-1', {
        iterationId: 'it-2',
      });
    });

    it('refuses to roll over inside an archived project', async () => {
      // An archived project is read-only end to end, and this is a write on its work items.
      repo.findById.mockResolvedValue(mockIteration({ state: 'committed' }));
      projects.assertProjectWritable.mockRejectedValue(
        new PreconditionFailedException('PROJECT_ARCHIVED', 'archived'),
      );
      await expect(service.rolloverUnfinished(actor, 'it-1')).rejects.toBeInstanceOf(
        PreconditionFailedException,
      );
      expect(workItemsSvc.updateWorkItem).not.toHaveBeenCalled();
    });
  });

  describe('createIteration', () => {
    it('mints an IT-<n> key from the per-project counter', async () => {
      repo.nextKeyNumber.mockResolvedValue(3);
      const it = await service.createIteration(actor, 'proj-1', 'Sprint 24.3', {
        startDate: '2024-06-01',
        endDate: '2024-06-14',
      });
      expect(it.iterationKey).toBe('IT-3');
    });

    it('rejects a team not linked to the project', async () => {
      projects.listProjectTeams.mockResolvedValue([{ teamId: 'other', status: 'active' }]);
      await expect(
        service.createIteration(actor, 'proj-1', 'X', { teamId: 'team-1' }),
      ).rejects.toBeInstanceOf(PreconditionFailedException);
    });

    it('rejects endDate before startDate', async () => {
      await expect(
        service.createIteration(actor, 'proj-1', 'X', {
          startDate: '2024-06-14',
          endDate: '2024-06-01',
        }),
      ).rejects.toBeInstanceOf(PreconditionFailedException);
    });

    /**
     * P23-03, second half. `state` went straight to the repository, so the machine could be
     * bypassed at BIRTH: an iteration created `accepted` is the one state the rule that owns
     * acceptance can never produce (§10.1 — "an empty Iteration must not auto-accept"), and nothing
     * would ever correct it, because `autoAcceptIterationIfComplete` only moves INTO `accepted`.
     */
    it('REFUSES creating an iteration already accepted — the machine has no back door', async () => {
      await expect(
        service.createIteration(actor, 'proj-1', 'X', { state: 'accepted' }),
      ).rejects.toMatchObject({ code: 'ITERATION_EMPTY' });
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('still allows the two states a create may legally start in', async () => {
      // Planning is the default (P2-IT-FR-023) and committing early is legal — the Phase 6
      // snapshot job depends on `state = 'committed'` being reachable from the start.
      await expect(
        service.createIteration(actor, 'proj-1', 'A', { state: 'planning' }),
      ).resolves.toMatchObject({ state: 'planning' });
      await expect(
        service.createIteration(actor, 'proj-1', 'B', { state: 'committed' }),
      ).resolves.toMatchObject({ state: 'committed' });
      expect(repo.create).toHaveBeenCalledTimes(2);
    });
  });

  describe('getIteration', () => {
    it('throws when not found or cross-workspace', async () => {
      repo.findById.mockResolvedValue(mockIteration({ workspaceId: 'other' }));
      await expect(service.getIteration('ws-1', 'it-1')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('commitIteration', () => {
    it('allows committing even when another iteration is already committed', async () => {
      repo.findById.mockResolvedValue(mockIteration({ state: 'planning' }));
      const updated = await service.commitIteration(actor, 'it-1');
      expect(updated.state).toBe('committed');
    });

    it('moves planning → committed', async () => {
      repo.findById.mockResolvedValue(mockIteration({ state: 'planning' }));
      const updated = await service.commitIteration(actor, 'it-1');
      expect(updated.state).toBe('committed');
    });
  });

  describe('acceptIteration', () => {
    it('accepts a PLANNING iteration whose items are all accepted', async () => {
      // Was `ITERATION_NOT_COMMITTED`. The BA never made `committed` a precondition of acceptance,
      // and `autoAcceptIterationIfComplete` accepts a planning iteration by itself — so the route
      // refused what the system does unprompted. The content gate below is the real precondition.
      repo.findById.mockResolvedValue(mockIteration({ state: 'planning' }));
      dbSelectResult = [{ total: 2, allAccepted: true }];
      await expect(service.acceptIteration(actor, 'it-1')).resolves.toMatchObject({
        state: 'accepted',
      });
    });

    it('refuses to accept an already-accepted iteration', async () => {
      repo.findById.mockResolvedValue(mockIteration({ state: 'accepted' }));
      await expect(service.acceptIteration(actor, 'it-1')).rejects.toMatchObject({
        code: 'ITERATION_INVALID_STATE_TRANSITION',
      });
    });

    it('rejects accepting an iteration with no assigned Story/Defect (ITERATION_EMPTY)', async () => {
      repo.findById.mockResolvedValue(mockIteration({ state: 'committed' }));
      dbSelectResult = [{ total: 0, allAccepted: null }];
      await expect(service.acceptIteration(actor, 'it-1')).rejects.toMatchObject({
        code: 'ITERATION_EMPTY',
      });
    });

    it('rejects accepting when not all items are accepted (ITERATION_NOT_ALL_ACCEPTED)', async () => {
      repo.findById.mockResolvedValue(mockIteration({ state: 'committed' }));
      dbSelectResult = [{ total: 3, allAccepted: false }];
      await expect(service.acceptIteration(actor, 'it-1')).rejects.toMatchObject({
        code: 'ITERATION_NOT_ALL_ACCEPTED',
      });
    });

    it('accepts when there is ≥1 item and all are accepted', async () => {
      repo.findById.mockResolvedValue(mockIteration({ state: 'committed' }));
      dbSelectResult = [{ total: 3, allAccepted: true }];
      const updated = await service.acceptIteration(actor, 'it-1');
      expect(updated.state).toBe('accepted');
      expect(repo.update).toHaveBeenCalledWith(
        'it-1',
        expect.objectContaining({ state: 'accepted' }),
      );
    });
  });

  describe('deleteIteration', () => {
    it('only allows deleting planning-state iterations', async () => {
      repo.findById.mockResolvedValue(mockIteration({ state: 'committed' }));
      await expect(service.deleteIteration(actor, 'it-1')).rejects.toBeInstanceOf(
        PreconditionFailedException,
      );
    });

    it('deletes a planning iteration that never recorded history', async () => {
      repo.findById.mockResolvedValue(mockIteration({ state: 'planning' }));
      dbSelectResult = [{ total: 0 }];
      await expect(service.deleteIteration(actor, 'it-1')).resolves.toBeUndefined();
      expect(repo.delete).toHaveBeenCalledWith('it-1');
    });

    /**
     * `fk_ids_iteration` is ON DELETE CASCADE and the snapshot cron only ever writes TODAY, so a
     * delete destroys days that cannot be measured again. Migration 0093 relied on a coincidence —
     * a delete needs `planning`, only a `committed` iteration is snapshotted — and its own comment
     * says "unreachable today is not an invariant". Allowing the manual reverse spends that
     * coincidence, so the rule is stated here instead.
     */
    it('refuses to delete a REOPENED iteration that already recorded Burndown history', async () => {
      repo.findById.mockResolvedValue(mockIteration({ state: 'planning' }));
      dbSelectResult = [{ total: 9 }];
      await expect(service.deleteIteration(actor, 'it-1')).rejects.toMatchObject({
        code: 'ITERATION_HAS_REPORT_HISTORY',
      });
      expect(repo.delete).not.toHaveBeenCalled();
    });
  });

  /**
   * PRJ-03. Commit and Accept were the only two writes in this service that skipped
   * `assertProjectWritable` — create, update, delete and rollover all carried it, which is exactly
   * the shape a call-site convention decays into.
   *
   * Committing matters more than it looks: `SnapshotCronService.findActiveIterations` selects on
   * `state = 'committed'` and nothing else, so committing an archived project's sprint also starts
   * the hourly Burndown job writing new `iteration_daily_snapshots` rows for it.
   */
  describe('an archived project refuses the two state transitions (PRJ-FR-010)', () => {
    beforeEach(() => {
      projects.assertProjectWritable.mockRejectedValue(
        new PreconditionFailedException('PROJECT_ARCHIVED', 'archived'),
      );
    });

    it('refuses a commit', async () => {
      repo.findById.mockResolvedValue(mockIteration({ state: 'planning' }));
      await expect(service.commitIteration(actor, 'it-1')).rejects.toMatchObject({
        code: 'PROJECT_ARCHIVED',
      });
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('refuses an accept', async () => {
      repo.findById.mockResolvedValue(mockIteration({ state: 'committed' }));
      dbSelectResult = [{ total: 3, allAccepted: true }];
      await expect(service.acceptIteration(actor, 'it-1')).rejects.toMatchObject({
        code: 'PROJECT_ARCHIVED',
      });
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('still LISTS its iterations — archived is read-only, not invisible', async () => {
      repo.listByProject.mockResolvedValue({
        data: [mockIteration()],
        pageInfo: { nextCursor: null, hasNextPage: false, limit: 25 },
      });
      repo.taskEstimatesByIteration.mockResolvedValue(new Map());
      await expect(
        service.listIterations(actor, 'proj-1', {}, { limit: 25, cursor: null }),
      ).resolves.toMatchObject({ data: [expect.objectContaining({ id: 'it-1' })] });
    });
  });
});
