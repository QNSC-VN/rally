import {
  applyDecorators,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
  SetMetadata,
  UseGuards,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard, PermissionGuard } from '@platform';
import type { JwtPayload } from '@platform';
import { permissionGrants, type Permission } from '@shared-kernel';
import { AccessService } from '../../application/access.service';

export const PROJECT_PERMISSION_KEY = 'requiredProjectPermission';

/** Where in the request the project id is found. */
export type ProjectIdSource = 'param' | 'query' | 'body';

interface ProjectPermissionMeta {
  permission: Permission;
  from: ProjectIdSource;
  field: string;
}

/**
 * Require a permission that is resolved PER PROJECT.
 *
 * Unlike @RequirePermission (which checks the flat, tenant-wide permissions
 * baked into the JWT), this resolves the caller's effective permissions for a
 * specific project at request time — unioning their tenant-wide baseline with
 * any role scoped to that project. Use it wherever a user may be admin of one
 * project but only a viewer of another.
 *
 * The project id is read from the request; say where:
 *   @RequireProjectPermission('project:edit')                         // route param :id
 *   @RequireProjectPermission('project:edit', 'param', 'projectId')   // route param :projectId
 *   @RequireProjectPermission('release:manage', 'body', 'projectId')  // create — projectId in body
 *   @RequireProjectPermission('iteration:view', 'query', 'projectId') // list — projectId in ?query
 *
 * For routes where the project is only reachable by loading a resource (e.g.
 * PATCH /releases/:releaseId — the project is on the release row), DON'T use
 * this guard; call AccessService.assertProjectPermission() in the service after
 * loading the resource, so we don't do a redundant lookup.
 */
export const RequireProjectPermission = (
  permission: Permission,
  from: ProjectIdSource = 'param',
  field = 'id',
) => SetMetadata(PROJECT_PERMISSION_KEY, { permission, from, field } satisfies ProjectPermissionMeta);

@Injectable()
export class ProjectPermissionGuard implements CanActivate {
  private readonly logger = new Logger(ProjectPermissionGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly accessService: AccessService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const meta = this.reflector.getAllAndOverride<ProjectPermissionMeta | undefined>(
      PROJECT_PERMISSION_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!meta) return true;

    const request = context.switchToHttp().getRequest<{
      user?: JwtPayload;
      params: Record<string, string>;
      query: Record<string, unknown>;
      body: Record<string, unknown>;
    }>();
    const user = request.user;

    // user is populated by JwtAuthGuard, which @Auth() guarantees runs before
    // this guard (see the combined @UseGuards ordering on the controller). A
    // missing user here means the guard ordering is wrong — fail closed.
    if (!user) {
      this.logger.error('ProjectPermissionGuard ran before JwtAuthGuard — check guard order');
      throw new ForbiddenException('Insufficient permissions');
    }

    // Fast path: a tenant-wide grant already in the JWT covers every project,
    // so there's no need to hit the DB for a project-scope lookup.
    if (permissionGrants(user.permissions, meta.permission)) return true;

    const projectId = this.extractProjectId(request, meta);
    if (!projectId) {
      this.logger.warn(
        { from: meta.from, field: meta.field, permission: meta.permission },
        'ProjectPermissionGuard: could not resolve project id from request',
      );
      throw new ForbiddenException('Insufficient permissions');
    }

    const effective = await this.accessService.getProjectPermissions(
      user.sub,
      user.workspaceId,
      projectId,
    );

    if (permissionGrants(effective, meta.permission)) return true;

    this.logger.warn(
      { userId: user.sub, projectId, permission: meta.permission },
      'ProjectPermissionGuard: access denied',
    );
    throw new ForbiddenException('Insufficient permissions');
  }

  private extractProjectId(
    request: {
      params: Record<string, string>;
      query: Record<string, unknown>;
      body: Record<string, unknown>;
    },
    meta: ProjectPermissionMeta,
  ): string | undefined {
    const bag =
      meta.from === 'param'
        ? request.params
        : meta.from === 'query'
          ? request.query
          : request.body;
    const value = bag?.[meta.field];
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  }
}

/**
 * Class decorator for controllers that use @RequireProjectPermission.
 *
 * Applies the guards in a GUARANTEED order — JwtAuthGuard (populates
 * request.user) → PermissionGuard (flat @RequirePermission) →
 * ProjectPermissionGuard (per-project) — in ONE @UseGuards call. Using two
 * separate decorators (@Auth() + @UseGuards(ProjectPermissionGuard)) does NOT
 * guarantee order, and Nest may run the project guard before auth, so use this
 * instead of @Auth() on those controllers.
 */
export const AuthProjectScoped = () =>
  applyDecorators(
    UseGuards(JwtAuthGuard, PermissionGuard, ProjectPermissionGuard),
    ApiBearerAuth('access-token'),
  );
