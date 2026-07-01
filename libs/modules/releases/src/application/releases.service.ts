import { Inject, Injectable, Logger } from '@nestjs/common';
import { uuidv7 } from 'uuidv7';
import { NotFoundException, PreconditionFailedException } from '@platform';
import type { JwtPayload, CursorPayload, PagedResult } from '@platform';
import { ProjectsService } from '@modules/projects';
import { IReleaseRepository, RELEASE_REPOSITORY } from '../domain/ports/release.repository';
import type { Release, UpdateReleaseInput } from '../domain/release.types';

@Injectable()
export class ReleasesService {
  private readonly logger = new Logger(ReleasesService.name);

  constructor(
    @Inject(RELEASE_REPOSITORY) private readonly releaseRepo: IReleaseRepository,
    private readonly projectsService: ProjectsService,
  ) {}

  // ── List ──────────────────────────────────────────────────────────────────

  async listReleases(
    actor: JwtPayload,
    projectId: string,
    args: { limit: number; cursor: CursorPayload | null },
  ): Promise<PagedResult<Release>> {
    await this.projectsService.getProject(actor.tenantId, projectId);
    return this.releaseRepo.listByProject(projectId, actor.tenantId, args);
  }

  // ── Create ────────────────────────────────────────────────────────────────

  async createRelease(
    actor: JwtPayload,
    projectId: string,
    name: string,
    opts: { description?: string; targetDate?: string } = {},
  ): Promise<Release> {
    await this.projectsService.getProject(actor.tenantId, projectId);

    const release = await this.releaseRepo.create({
      id: uuidv7(),
      tenantId: actor.tenantId,
      projectId,
      name,
      description: opts.description,
      targetDate: opts.targetDate,
    });

    this.logger.log({ releaseId: release.id, projectId, userId: actor.sub }, 'Release created');
    return release;
  }

  // ── Get ───────────────────────────────────────────────────────────────────

  async getRelease(tenantId: string, id: string): Promise<Release> {
    const release = await this.releaseRepo.findById(id);
    if (!release || release.tenantId !== tenantId) {
      throw new NotFoundException('RELEASE_NOT_FOUND', 'Release not found');
    }
    return release;
  }

  // ── Update ────────────────────────────────────────────────────────────────

  async updateRelease(tenantId: string, id: string, input: UpdateReleaseInput): Promise<Release> {
    await this.getRelease(tenantId, id);
    return this.releaseRepo.update(id, input);
  }

  // ── Delete ────────────────────────────────────────────────────────────────

  async deleteRelease(tenantId: string, id: string): Promise<void> {
    const release = await this.getRelease(tenantId, id);
    if (release.status === 'released') {
      throw new PreconditionFailedException(
        'RELEASE_NOT_FOUND',
        'Released versions cannot be deleted',
      );
    }
    await this.releaseRepo.delete(id);
    this.logger.log({ releaseId: id }, 'Release deleted');
  }

  // ── Ship ─────────────────────────────────────────────────────────────────

  async shipRelease(tenantId: string, id: string): Promise<Release> {
    const release = await this.getRelease(tenantId, id);
    if (release.status === 'released') {
      throw new PreconditionFailedException('RELEASE_NOT_FOUND', 'Release has already shipped');
    }
    const updated = await this.releaseRepo.update(id, {
      status: 'released',
      releasedAt: new Date(),
    });
    this.logger.log({ releaseId: id }, 'Release shipped');
    return updated;
  }
}
