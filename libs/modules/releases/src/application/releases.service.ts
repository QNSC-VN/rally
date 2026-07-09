import { Inject, Injectable, Logger, NotFoundException, PreconditionFailedException, BadRequestException } from '@nestjs/common';
import { uuidv7 } from 'uuidv7';
import type { JwtPayload, CursorPayload, PagedResult } from '@platform';
import { ProjectsService } from '@modules/projects';
import { AccessService } from '@modules/access';
import { PERMISSION } from '@shared-kernel';
import { IReleaseRepository, RELEASE_REPOSITORY } from '../domain/ports/release.repository';
import type { Release, UpdateReleaseInput } from '../domain/release.types';

@Injectable()
export class ReleasesService {
  private readonly logger = new Logger(ReleasesService.name);

  constructor(
    @Inject(RELEASE_REPOSITORY) private readonly releaseRepo: IReleaseRepository,
    private readonly projectsService: ProjectsService,
    private readonly accessService: AccessService,
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
    opts: {
      description?: string;
      theme?: string;
      startDate?: string;
      releaseDate?: string;
      state?: string;
    } = {},
  ): Promise<Release> {
    await this.projectsService.getProject(actor.tenantId, projectId);

    // Validate date range: releaseDate >= startDate
    if (opts.startDate && opts.releaseDate && opts.releaseDate < opts.startDate) {
      throw new BadRequestException('Release date must be >= start date');
    }

    const release = await this.releaseRepo.create({
      id: uuidv7(),
      tenantId: actor.tenantId,
      projectId,
      name,
      description: opts.description,
      theme: opts.theme,
      startDate: opts.startDate,
      releaseDate: opts.releaseDate,
      status: (opts.state as Release['status']) ?? 'planning',
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

  async updateRelease(actor: JwtPayload, id: string, input: UpdateReleaseInput): Promise<Release> {
    const release = await this.getRelease(actor.tenantId, id);
    await this.accessService.assertProjectPermission(actor, release.projectId, PERMISSION.RELEASE_MANAGE);

    // Validate date range: releaseDate >= startDate
    if (input.startDate && input.releaseDate && input.releaseDate < input.startDate) {
      throw new BadRequestException('Release date must be >= start date');
    }

    return this.releaseRepo.update(id, input);
  }

  // ── Delete ────────────────────────────────────────────────────────────────

  async deleteRelease(actor: JwtPayload, id: string): Promise<void> {
    const release = await this.getRelease(actor.tenantId, id);
    await this.accessService.assertProjectPermission(actor, release.projectId, PERMISSION.RELEASE_MANAGE);
    // Accepted releases cannot be deleted (P3-REL-DC-012: accepted remain editable, but deletion is more destructive)
    if (release.status === 'accepted') {
      throw new PreconditionFailedException(
        'RELEASE_NOT_DELETABLE',
        'Accepted releases cannot be deleted',
      );
    }
    await this.releaseRepo.delete(id);
    this.logger.log({ releaseId: id }, 'Release deleted');
  }

  // ── Get Detail (includes notes, taskRollup, accepted) ─────────────────────

  async getReleaseDetail(actor: JwtPayload, id: string) {
    const release = await this.getRelease(actor.tenantId, id);
    return release;
  }
}