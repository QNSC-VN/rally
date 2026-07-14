import {
  SetMetadata,
  applyDecorators,
  UseGuards,
  createParamDecorator,
  ExecutionContext,
} from '@nestjs/common';
import { ApiBearerAuth, ApiResponse } from '@nestjs/swagger';
import { JwtAuthGuard } from './jwt.guard';
import { PermissionGuard } from '@qnsc-vn/identity';
import type { JwtPayload } from './jwt.strategy';
import type { WorkspacePermission } from '@shared-kernel';

export const IS_PUBLIC_KEY = 'isPublic';
export const PERMISSION_KEY = 'requiredPermission';

/** Mark a route as unauthenticated (skip JwtAuthGuard). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/**
 * Require a WORKSPACE-tier permission, checked against the flat workspace-wide
 * baseline in the JWT (via PermissionGuard).
 *
 * The signature only accepts workspace-tier codes on purpose: a project-tier
 * permission (work_item:*, iteration:*, project:edit, …) must be resolved
 * per-project, so passing one here is a COMPILE error — use
 * @RequireProjectPermission (project id in the request) or
 * AccessService.assertProjectPermission (project id known only after a load).
 */
export const RequirePermission = (permission: WorkspacePermission) =>
  SetMetadata(PERMISSION_KEY, permission);

/**
 * Extract the authenticated user's JWT payload from the request.
 * Only use on routes protected by @Auth() or JwtAuthGuard.
 *
 * @example
 * async getMe(@CurrentUser() user: JwtPayload) { ... }
 */
export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): JwtPayload => {
  const request = ctx.switchToHttp().getRequest<{ user: JwtPayload }>();
  return request.user;
});

// ── Swagger error-response shortcuts ────────────────────────────────────────

type HttpErrorCode = 400 | 401 | 403 | 404 | 409 | 422 | 429;

const HTTP_ERROR_DESCRIPTIONS: Record<HttpErrorCode, string> = {
  400: 'Bad Request — validation error or malformed input',
  401: 'Unauthorized — missing or invalid authentication',
  403: 'Forbidden — insufficient permissions',
  404: 'Not Found',
  409: 'Conflict — duplicate record or state conflict',
  422: 'Unprocessable — business rule violation',
  429: 'Too Many Requests — rate limit exceeded',
};

/**
 * Attach standard @ApiResponse decorators in one call.
 *
 * @example
 * // Authenticated write with conflict risk:
 * @ApiCommonErrors(400, 401, 403, 404, 409)
 */
export const ApiCommonErrors = (...codes: HttpErrorCode[]) =>
  applyDecorators(
    ...codes.map((c) => ApiResponse({ status: c, description: HTTP_ERROR_DESCRIPTIONS[c] })),
  );

/** Apply JWT auth + permission guard + Swagger bearer annotation in one decorator. */
export const Auth = (permission?: WorkspacePermission) =>
  applyDecorators(
    ...[
      UseGuards(JwtAuthGuard, PermissionGuard),
      ApiBearerAuth('access-token'),
      ...(permission ? [RequirePermission(permission)] : []),
    ],
  );
