import {
  applyDecorators,
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  SetMetadata,
  UseGuards,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard, PermissionDeniedException } from '@platform';
import type { JwtPayload } from '@platform';
import {
  permissionGrants,
  isProjectTierPermission,
  type WorkspacePermission,
  type ProjectPermission,
  type Permission,
} from '@shared-kernel';
import { AccessService } from '../../application/access.service';
import { ProjectScopeResolver, type ScopedResource } from '../../application/project-scope.resolver';

export const POLICY_KEY = 'policy';

type IdSource = 'param' | 'query' | 'body';

/** How the guard finds the project a project-tier permission is checked against. */
export type PolicyScope =
  /** The project id is directly in the request (create/list routes). */
  | { from: IdSource; field: string }
  /** Load `resource` by an id in the request → use its projectId (post-load routes). */
  | { resource: ScopedResource; from: IdSource; field: string };

interface PolicyMeta {
  permission: Permission;
  scope?: PolicyScope;
}

/**
 * The single authorization decorator. Tier-safe by overload:
 *   - a WORKSPACE-tier code takes NO scope (checked against the JWT baseline);
 *   - a PROJECT-tier code REQUIRES a scope telling the guard where the project is
 *     — either directly in the request (`{ from, field }`) or via a resource load
 *     (`{ resource, from, field }`).
 * Passing the wrong shape is a compile error.
 */
export function RequirePermission(permission: WorkspacePermission): MethodDecorator & ClassDecorator;
export function RequirePermission(
  permission: ProjectPermission,
  scope: PolicyScope,
): MethodDecorator & ClassDecorator;
export function RequirePermission(permission: Permission, scope?: PolicyScope) {
  return SetMetadata(POLICY_KEY, { permission, scope } satisfies PolicyMeta);
}

/**
 * ONE guard for every authorization decision (replaces PermissionGuard +
 * ProjectPermissionGuard + service-level assertProjectPermission):
 *   - workspace-tier ⇒ check the JWT baseline;
 *   - project-tier   ⇒ fast-path a workspace-wide grant, else resolve the
 *     project (from the request or by loading the resource) and check
 *     `baseline ∪ project-scoped role`.
 * Deny ⇒ PROJECT_PERMISSION_DENIED. Fail-closed if the user is missing.
 */
@Injectable()
export class PolicyGuard implements CanActivate {
  private readonly logger = new Logger(PolicyGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly accessService: AccessService,
    private readonly scopeResolver: ProjectScopeResolver,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const meta = this.reflector.getAllAndOverride<PolicyMeta | undefined>(POLICY_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!meta) return true;

    const request = context.switchToHttp().getRequest<{
      user?: JwtPayload;
      params: Record<string, string>;
      query: Record<string, unknown>;
      body: Record<string, unknown>;
    }>();
    const user = request.user;
    if (!user) {
      this.logger.error('PolicyGuard ran before JwtAuthGuard — check guard order');
      throw this.deny();
    }

    const { permission, scope } = meta;

    // Workspace-tier: the flat baseline in the JWT is authoritative.
    if (!isProjectTierPermission(permission)) {
      if (permissionGrants(user.permissions, permission)) return true;
      throw this.deny();
    }

    // Project-tier fast path: a workspace-wide grant covers every project.
    if (permissionGrants(user.permissions, permission)) return true;

    const projectId = await this.resolveProjectId(request, scope, user.workspaceId);
    if (!projectId) throw this.deny();

    const effective = await this.accessService.getProjectPermissions(
      user.sub,
      user.workspaceId,
      projectId,
    );
    if (permissionGrants(effective, permission)) return true;

    this.logger.warn({ userId: user.sub, projectId, permission }, 'PolicyGuard: access denied');
    throw this.deny();
  }

  private async resolveProjectId(
    request: {
      params: Record<string, string>;
      query: Record<string, unknown>;
      body: Record<string, unknown>;
    },
    scope: PolicyScope | undefined,
    workspaceId: string,
  ): Promise<string | undefined> {
    if (!scope) return undefined;
    const id = this.extract(request, scope.from, scope.field);
    if (!id) return undefined;
    // `resource` scope ⇒ the id is the resource's own id; load it → projectId.
    if ('resource' in scope) return this.scopeResolver.resolve(scope.resource, id, workspaceId);
    // Otherwise the id IS the projectId.
    return id;
  }

  private extract(
    request: {
      params: Record<string, string>;
      query: Record<string, unknown>;
      body: Record<string, unknown>;
    },
    from: IdSource,
    field: string,
  ): string | undefined {
    const bag = from === 'param' ? request.params : from === 'query' ? request.query : request.body;
    const value = bag?.[field];
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  }

  private deny(): PermissionDeniedException {
    return new PermissionDeniedException(
      'PROJECT_PERMISSION_DENIED',
      'You do not have permission to perform this action',
    );
  }
}

/**
 * Class decorator for controllers using the unified `@RequirePermission`.
 * Bundles JwtAuthGuard → PolicyGuard in ONE @UseGuards (guaranteed order).
 */
export const AuthPolicy = () =>
  applyDecorators(UseGuards(JwtAuthGuard, PolicyGuard), ApiBearerAuth('access-token'));
