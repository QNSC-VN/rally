import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSION_KEY } from './decorators';
import type { JwtPayload } from './jwt.strategy';

/**
 * Permission guard — reads the required permission code from @RequirePermission()
 * and verifies the caller's JWT claims (permissions[] embedded at mint time).
 *
 * Wildcard: a permission of 'workspace:*' grants all workspace-level actions.
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  private readonly logger = new Logger(PermissionGuard.name);

  constructor(private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredPermission = this.reflector.getAllAndOverride<string | undefined>(
      PERMISSION_KEY,
      [context.getHandler(), context.getClass()],
    );

    // No permission annotation on this endpoint → JWT auth is sufficient.
    if (!requiredPermission) return true;

    const request = context.switchToHttp().getRequest<{ user?: JwtPayload }>();
    const user = request.user;

    if (!user?.permissions?.length) {
      this.logger.warn({ requiredPermission }, 'PermissionGuard: no permissions in JWT');
      throw new ForbiddenException('Insufficient permissions');
    }

    // Workspace wildcard grants everything.
    if (user.permissions.includes('workspace:*')) return true;

    if (!user.permissions.includes(requiredPermission)) {
      this.logger.warn(
        { userId: user.sub, requiredPermission },
        'PermissionGuard: access denied',
      );
      throw new ForbiddenException('Insufficient permissions');
    }

    return true;
  }
}
