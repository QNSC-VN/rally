import {
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';
import '@fastify/cookie';
import { Auth, UnauthorizedException } from '@platform';
import type { JwtPayload } from '@platform';
import { AuthService } from '@qnsc-vn/identity';
import { AccessService } from '@modules/access';
import { WorkspaceService } from '@modules/workspace';
import { BffService } from '../../../application/bff/bff.service';
import { readCookie } from '../../../application/bff/bff.util';
import { CurrentUser } from '../decorators/current-user.decorator';
import { UserProfileResponseDto } from '../dto/auth-response.dto';
import { SwitchWorkspaceDto } from '../dto/login.dto';
import {
  BFF_SESSION_COOKIE,
  BFF_STATE_COOKIE,
  BFF_STATE_COOKIE_MAX_AGE_SECONDS,
} from './bff.constants';

/**
 * Backend-for-Frontend auth surface. Runs the Entra Authorization-Code + PKCE
 * flow server-side and issues an opaque `__Host-` session cookie so tokens
 * never reach the browser. The whole controller is inert (404) unless
 * `AUTH_MODE=bff`, so the default legacy MSAL path is byte-for-byte unchanged.
 *
 * Excluded from Swagger: these are browser-redirect endpoints, not a JSON API.
 */
@ApiExcludeController()
@Controller('bff')
export class BffController {
  constructor(
    private readonly bff: BffService,
    private readonly authService: AuthService,
    private readonly accessService: AccessService,
    private readonly workspaceService: WorkspaceService,
  ) {}

  // ── GET /bff/login ───────────────────────────────────────────────────────
  // Public: starts the flow. Sets the browser-bound `state` cookie and 302s to
  // Entra. `returnTo` is validated to a same-origin path (open-redirect guard).
  @Get('login')
  async login(
    @Query('returnTo') returnTo: string | undefined,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    this.ensureEnabled();
    const { authorizeUrl, state } = await this.bff.beginLogin(returnTo);

    reply.setCookie(BFF_STATE_COOKIE, state, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax', // must survive the top-level redirect back from Entra
      path: '/',
      maxAge: BFF_STATE_COOKIE_MAX_AGE_SECONDS,
    });
    this.redirect(reply, authorizeUrl);
  }

  // ── GET /bff/callback ────────────────────────────────────────────────────
  // Public: Entra redirects here with ?code&state. Verifies state, exchanges the
  // code, mints a session, sets the `__Host-` session cookie, and 302s to returnTo.
  @Get('callback')
  async callback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    this.ensureEnabled();
    if (!code || !state) {
      throw new UnauthorizedException('AUTH_TOKEN_INVALID', 'Missing authorization code or state');
    }

    const cookieState = readCookie(req, BFF_STATE_COOKIE);
    let result: { sid: string; returnTo: string };
    try {
      result = await this.bff.completeLogin({ code, state, cookieState, ip: req.ip });
    } catch {
      // Never surface OIDC/internal detail to the browser on the login path.
      throw new UnauthorizedException('AUTH_TOKEN_INVALID', 'Login could not be completed');
    }

    reply.clearCookie(BFF_STATE_COOKIE, { path: '/' });
    reply.setCookie(BFF_SESSION_COOKIE, result.sid, {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      path: '/',
      maxAge: this.bff.sessionTtlSeconds,
    });
    this.redirect(reply, result.returnTo);
  }

  // ── POST /bff/logout ─────────────────────────────────────────────────────
  // Authenticated via the shared guard's session-cookie path (@Auth). `bffSid`
  // is populated by JwtAuthGuard when it resolves the session.
  @Post('logout')
  @HttpCode(204)
  @Auth()
  async logout(
    @CurrentUser() user: JwtPayload,
    @Req() req: FastifyRequest & { bffSid?: string },
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    this.ensureEnabled();
    const sid = req.bffSid ?? readCookie(req, BFF_SESSION_COOKIE);
    if (sid) {
      await this.bff.logout(sid, user);
    }
    reply.clearCookie(BFF_SESSION_COOKIE, { path: '/' });
  }

  // ── POST /bff/switch-workspace ───────────────────────────────────────────
  // Session-cookie authenticated mirror of POST /v1/auth/switch-workspace.
  // Re-issues tokens for the target workspace and stores them on the SAME
  // session, so the browser keeps its existing session cookie and simply starts
  // resolving to the new workspace. No token is returned to the client.
  @Post('switch-workspace')
  @HttpCode(204)
  @Auth()
  async switchWorkspace(
    @Body() dto: SwitchWorkspaceDto,
    @Req() req: FastifyRequest & { bffSid?: string },
  ): Promise<void> {
    this.ensureEnabled();
    const sid = req.bffSid ?? readCookie(req, BFF_SESSION_COOKIE);
    if (!sid) {
      throw new UnauthorizedException('AUTH_TOKEN_INVALID', 'No active BFF session');
    }
    const claims = await this.bff.switchWorkspace(sid, dto.workspaceId, req.ip);
    if (!claims) {
      throw new UnauthorizedException('AUTH_TOKEN_INVALID', 'Session no longer exists');
    }
  }

  // ── GET /bff/me ──────────────────────────────────────────────────────────
  // Session-cookie authenticated mirror of GET /v1/auth/me.
  @Get('me')
  @Auth()
  async me(@CurrentUser() user: JwtPayload): Promise<UserProfileResponseDto> {
    this.ensureEnabled();
    const [profile, { role, permissions }, memberships] = await Promise.all([
      this.authService.getMe(user.sub),
      this.accessService.getUserRoleAndPermissions(user.sub, user.workspaceId),
      this.workspaceService.getMemberships(user.sub),
    ]);
    return {
      id: profile.id,
      email: profile.email,
      displayName: profile.displayName,
      avatarUrl: profile.avatarUrl,
      locale: profile.locale,
      timezone: profile.timezone,
      role,
      permissions,
      emailVerified: profile.emailVerified,
      createdAt: profile.createdAt.toISOString(),
      updatedAt: profile.updatedAt.toISOString(),
      memberships,
    };
  }

  private ensureEnabled(): void {
    if (!this.bff.enabled) {
      throw new NotFoundException();
    }
  }

  /** Version-agnostic 302 redirect (avoids Fastify `reply.redirect` arg-order drift). */
  private redirect(reply: FastifyReply, url: string): void {
    reply.header('location', url).status(302).send();
  }
}
