/**
 * `QualityService` has one method, and its whole job is now composition: resolve the project, resolve
 * the caller's TEAM SCOPE once, and hand that one scope to both repository calls.
 *
 * The scope resolution is the read half of the BA ruling of 2026-08-17 ("Editor … cannot access
 * team-less items. Enforce this consistently in API queries, lists, reports, search, pickers and
 * direct URLs") and of §5's Editor row for this surface ("Quality Defects View = Assigned Teams").
 * The PREDICATES it turns into are pinned next door in
 * `infrastructure/persistence/quality.drizzle-repository.predicates.spec.ts`; what is pinned here is
 * that the scope is resolved ONCE and reaches BOTH readers — the grid and the KPI strip. Resolving it
 * twice would let the 5-minute assignment cache expire between the two and produce a strip measured
 * over a population its own rows do not have, which is the fault CLAUDE.md records for Velocity's
 * eligibility join and for `countScheduledWork`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { ProjectsService } from '@modules/projects';
import { AccessService } from '@modules/access';
import { QualityService } from './quality.service';
import { QUALITY_REPOSITORY } from '../domain/ports/quality.repository';

const actor = { sub: 'user-1', workspaceId: 'ws-1' } as never;

const METRICS = {
  openDefects: 3,
  critical: 1,
  inProgress: 2,
  verifiedAccepted: 0,
  reopened: 0,
  blockers: 0,
};

describe('QualityService', () => {
  let service: QualityService;
  let repo: {
    listDefects: ReturnType<typeof vi.fn>;
    computeMetrics: ReturnType<typeof vi.fn>;
  };
  let projects: { getProject: ReturnType<typeof vi.fn> };
  let access: { resolveTeamScope: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    repo = {
      listDefects: vi.fn().mockResolvedValue({ rows: [{ id: 'wi-1' }], total: 1 }),
      computeMetrics: vi.fn().mockResolvedValue(METRICS),
    };
    projects = { getProject: vi.fn().mockResolvedValue({ id: 'proj-1' }) };
    access = { resolveTeamScope: vi.fn().mockResolvedValue({ unrestricted: true }) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QualityService,
        { provide: QUALITY_REPOSITORY, useValue: repo },
        { provide: ProjectsService, useValue: projects },
        { provide: AccessService, useValue: access },
      ],
    }).compile();

    service = module.get(QualityService);
  });

  it('validates the project before reading anything', async () => {
    projects.getProject.mockRejectedValue(new Error('PROJECT_NOT_FOUND'));

    await expect(service.getDefects(actor, 'bad-proj')).rejects.toThrow('PROJECT_NOT_FOUND');

    expect(access.resolveTeamScope).not.toHaveBeenCalled();
    expect(repo.listDefects).not.toHaveBeenCalled();
    expect(repo.computeMetrics).not.toHaveBeenCalled();
  });

  it('resolves the team scope for the project being read', async () => {
    await service.getDefects(actor, 'proj-1');

    expect(access.resolveTeamScope).toHaveBeenCalledWith('ws-1', 'user-1', 'proj-1');
  });

  it('passes an UNRESTRICTED scope through to both readers, unchanged', async () => {
    const res = await service.getDefects(actor, 'proj-1', { severity: 'critical' });

    expect(repo.listDefects).toHaveBeenCalledWith(
      'ws-1',
      'proj-1',
      { severity: 'critical' },
      { unrestricted: true },
    );
    expect(repo.computeMetrics).toHaveBeenCalledWith('ws-1', 'proj-1', { unrestricted: true });
    expect(res).toEqual({ metrics: METRICS, data: [{ id: 'wi-1' }], total: 1 });
  });

  it("narrows the grid AND the strip by an editor's teams — one resolution, two readers", async () => {
    const scope = { unrestricted: false, teamIds: ['team-a'] };
    access.resolveTeamScope.mockResolvedValue(scope);

    await service.getDefects(actor, 'proj-1');

    // One resolution: two would let the assignment cache expire between the grid and the strip.
    expect(access.resolveTeamScope).toHaveBeenCalledTimes(1);
    // The SAME object reaches both, so they cannot be narrowed differently.
    expect(repo.listDefects.mock.calls[0][3]).toBe(scope);
    expect(repo.computeMetrics.mock.calls[0][2]).toBe(scope);
  });

  it('forwards an EMPTY editor scope rather than dropping it', async () => {
    // `[]` is a real answer meaning "no delivery scope", and the repository short-circuits it to no
    // rows and zeroed metrics. The service must not "helpfully" treat it as unrestricted, which is
    // the `null`-versus-`[]` flattening `listReadableProjectIds` documents.
    const scope = { unrestricted: false, teamIds: [] };
    access.resolveTeamScope.mockResolvedValue(scope);

    await service.getDefects(actor, 'proj-1');

    expect(repo.listDefects.mock.calls[0][3]).toEqual({ unrestricted: false, teamIds: [] });
    expect(repo.computeMetrics.mock.calls[0][2]).toEqual({ unrestricted: false, teamIds: [] });
  });
});
