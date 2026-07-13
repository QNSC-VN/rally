import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import {
  NotFoundException,
  PreconditionFailedException,
  BadRequestException,
} from '@nestjs/common';
import { ReleasesService } from './releases.service';
import { RELEASE_REPOSITORY } from '../domain/ports/release.repository';
import { ProjectsService } from '@modules/projects';
import { AccessService } from '@modules/access';
import { DRIZZLE } from '@platform';
import type { Release } from '../domain/release.types';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const now = new Date('2024-06-01');

const actor = {
  sub: 'user-1',
  workspaceId: 'ws-1',
  sessionId: 's1',
  jti: 'j1',
  iat: 0,
  exp: 0,
  iss: 'rally',
  aud: 'rally-app',
  permissions: [] as string[],
  authMethod: 'password' as const,
};

const mockRelease = (o: Partial<Release> = {}): Release => ({
  id: 'rel-1',
  workspaceId: 'ws-1',
  projectId: 'proj-1',
  name: 'v1.0',
  description: 'First release',
  theme: null,
  notes: null,
  status: 'planning',
  startDate: '2024-06-01',
  releaseDate: '2024-07-01',
  targetDate: null,
  plannedVelocity: null,
  planEstimate: null,
  version: null,
  releasedAt: null,
  releaseNotes: null,
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
  findById: vi.fn(),
  listByProject: vi.fn().mockResolvedValue(emptyPage),
  create: vi.fn().mockImplementation((input) => Promise.resolve(mockRelease(input))),
  update: vi.fn().mockImplementation((id, patch) => Promise.resolve(mockRelease({ id, ...patch }))),
  delete: vi.fn().mockResolvedValue(undefined),
});

const makeProjects = () => ({
  getProject: vi.fn().mockResolvedValue({ id: 'proj-1' }),
});

const makeAccess = () => ({
  assertProjectPermission: vi.fn().mockResolvedValue(undefined),
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('ReleasesService', () => {
  let service: ReleasesService;
  let repo: ReturnType<typeof makeRepo>;
  let projects: ReturnType<typeof makeProjects>;
  let access: ReturnType<typeof makeAccess>;

  beforeEach(async () => {
    repo = makeRepo();
    projects = makeProjects();
    access = makeAccess();

    const mockDrizzle = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([
        {
          totalItems: 0,
          completedItems: 0,
          totalPoints: '0',
          completedPoints: '0',
        },
      ]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReleasesService,
        { provide: RELEASE_REPOSITORY, useValue: repo },
        { provide: DRIZZLE, useValue: mockDrizzle },
        { provide: ProjectsService, useValue: projects },
        { provide: AccessService, useValue: access },
      ],
    }).compile();

    service = module.get(ReleasesService);
  });

  // ── listReleases ──────────────────────────────────────────────────────────

  describe('listReleases', () => {
    it('validates project access before listing', async () => {
      await service.listReleases(actor, 'proj-1', { limit: 25, cursor: null });
      expect(projects.getProject).toHaveBeenCalledWith('ws-1', 'proj-1');
    });

    it('propagates project-not-found', async () => {
      projects.getProject.mockRejectedValue(new Error('PROJECT_NOT_FOUND'));
      await expect(service.listReleases(actor, 'bad', { limit: 25, cursor: null })).rejects.toThrow(
        'PROJECT_NOT_FOUND',
      );
    });
  });

  // ── createRelease ─────────────────────────────────────────────────────────

  describe('createRelease', () => {
    it('creates with default planning status when none provided', async () => {
      const result = await service.createRelease(actor, 'proj-1', 'v2.0');
      expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ status: 'planning' }));
      expect(result.status).toBe('planning');
    });

    it('uses provided status when given', async () => {
      await service.createRelease(actor, 'proj-1', 'v2.0', { state: 'active' });
      expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ status: 'active' }));
    });

    it('rejects releaseDate before startDate', async () => {
      await expect(
        service.createRelease(actor, 'proj-1', 'v2.0', {
          startDate: '2024-07-01',
          releaseDate: '2024-06-01',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('allows releaseDate equal to startDate', async () => {
      await service.createRelease(actor, 'proj-1', 'v2.0', {
        startDate: '2024-06-01',
        releaseDate: '2024-06-01',
      });
      expect(repo.create).toHaveBeenCalled();
    });

    it('allows creation with only startDate (no releaseDate)', async () => {
      await service.createRelease(actor, 'proj-1', 'v2.0', {
        startDate: '2024-06-01',
      });
      expect(repo.create).toHaveBeenCalled();
    });

    it('validates project exists before creating', async () => {
      projects.getProject.mockRejectedValue(new Error('PROJECT_NOT_FOUND'));
      await expect(service.createRelease(actor, 'bad', 'v2.0')).rejects.toThrow(
        'PROJECT_NOT_FOUND',
      );
      expect(repo.create).not.toHaveBeenCalled();
    });
  });

  // ── getRelease ───────────────────────────────────────────────────────────

  describe('getRelease', () => {
    it('returns release when found in same workspace', async () => {
      repo.findById.mockResolvedValue(mockRelease());
      const result = await service.getRelease('ws-1', 'rel-1');
      expect(result.id).toBe('rel-1');
    });

    it('throws when release not found', async () => {
      repo.findById.mockResolvedValue(null);
      await expect(service.getRelease('ws-1', 'bad')).rejects.toThrow(NotFoundException);
    });

    it('throws when release belongs to different workspace', async () => {
      repo.findById.mockResolvedValue(mockRelease({ workspaceId: 'other-ws' }));
      await expect(service.getRelease('ws-1', 'rel-1')).rejects.toThrow(NotFoundException);
    });
  });

  // ── updateRelease ────────────────────────────────────────────────────────

  describe('updateRelease', () => {
    it('asserts release:manage permission for the release project', async () => {
      repo.findById.mockResolvedValue(mockRelease());
      await service.updateRelease(actor, 'rel-1', { name: 'Renamed' });
      expect(access.assertProjectPermission).toHaveBeenCalledWith(
        actor,
        'proj-1',
        expect.any(String),
      );
    });

    it('rejects releaseDate before startDate on update', async () => {
      repo.findById.mockResolvedValue(mockRelease());
      await expect(
        service.updateRelease(actor, 'rel-1', {
          startDate: '2024-07-01',
          releaseDate: '2024-06-01',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when release not found', async () => {
      repo.findById.mockResolvedValue(null);
      await expect(service.updateRelease(actor, 'bad', { name: 'X' })).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ── deleteRelease ────────────────────────────────────────────────────────

  describe('deleteRelease', () => {
    it('deletes a planning release', async () => {
      repo.findById.mockResolvedValue(mockRelease({ status: 'planning' }));
      await service.deleteRelease(actor, 'rel-1');
      expect(repo.delete).toHaveBeenCalledWith('rel-1');
    });

    it('deletes an active release', async () => {
      repo.findById.mockResolvedValue(mockRelease({ status: 'active' }));
      await service.deleteRelease(actor, 'rel-1');
      expect(repo.delete).toHaveBeenCalledWith('rel-1');
    });

    it('rejects deleting an accepted release (P3-REL-DC-012)', async () => {
      repo.findById.mockResolvedValue(mockRelease({ status: 'accepted' }));
      await expect(service.deleteRelease(actor, 'rel-1')).rejects.toThrow(
        PreconditionFailedException,
      );
      expect(repo.delete).not.toHaveBeenCalled();
    });

    it('asserts permission before deletion', async () => {
      repo.findById.mockResolvedValue(mockRelease());
      await service.deleteRelease(actor, 'rel-1');
      expect(access.assertProjectPermission).toHaveBeenCalled();
    });
  });

  // ── getReleaseDetail ─────────────────────────────────────────────────────

  describe('getReleaseDetail', () => {
    it('returns the release when found', async () => {
      repo.findById.mockResolvedValue(mockRelease());
      const result = await service.getReleaseDetail(actor, 'rel-1');
      expect(result.id).toBe('rel-1');
    });

    it('throws when release not found', async () => {
      repo.findById.mockResolvedValue(null);
      await expect(service.getReleaseDetail(actor, 'bad')).rejects.toThrow(NotFoundException);
    });
  });
});
