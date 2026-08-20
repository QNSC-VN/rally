import {
  SetMetadata,
  applyDecorators,
  UseGuards,
  createParamDecorator,
  ExecutionContext,
} from '@nestjs/common';
import { ApiBearerAuth, ApiResponse } from '@nestjs/swagger';
import { JwtAuthGuard } from './jwt.guard';
import type { JwtPayload } from './jwt.strategy';

export const IS_PUBLIC_KEY = 'isPublic';

/** Mark a route as unauthenticated (skip JwtAuthGuard). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

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

/**
 * 412 is here because `PreconditionFailedException` is this codebase's most common refusal — the state
 * of the target is wrong for a request that is otherwise well-formed and authorized — and the union
 * omitted it, so those routes had to document themselves as 422 or say nothing.
 */
type HttpErrorCode = 400 | 401 | 403 | 404 | 409 | 412 | 422 | 429;

const HTTP_ERROR_DESCRIPTIONS: Record<HttpErrorCode, string> = {
  400: 'Bad Request — validation error or malformed input',
  401: 'Unauthorized — missing or invalid authentication',
  403: 'Forbidden — insufficient permissions',
  404: 'Not Found',
  409: 'Conflict — duplicate record or state conflict',
  412: 'Precondition Failed — the target is not in a state that allows this',
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

/**
 * Authentication only: verify the caller (Bearer or BFF session) and annotate
 * Swagger. It carries NO authorization — a route under `@Auth()` alone is open to
 * every authenticated caller, which is correct only for surfaces that are
 * self-scoped by construction (`me/*`, `notifications/*` — addressed by
 * `user.sub`) or that run around a session existing (`auth/*`).
 *
 * For anything that resolves a workspace or project resource, use `@AuthPolicy()`
 * on the controller plus `@RequirePermission(...)` from `@modules/access`, which
 * is the single authorization decision point. `@Auth()` used to also mount the
 * `PermissionGuard` from `@qnsc-vn/identity` and accept a workspace-tier code;
 * both are gone now that every permission check runs through `PolicyGuard`.
 */
export const Auth = () => applyDecorators(UseGuards(JwtAuthGuard), ApiBearerAuth('access-token'));
