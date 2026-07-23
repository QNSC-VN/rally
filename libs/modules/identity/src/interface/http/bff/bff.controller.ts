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
import { Auth, Public, UnauthorizedException } from '@platform';
import type { JwtPayload } from '@platform';
import { AuthService, BffService, readCookie } from '@qnsc-vn/identity';
import { AccessService } from '@modules/access';
import { WorkspaceService } from '@modules/workspace';
import { CurrentUser } from '../decorators/current-user.decorator';
import { UserProfileResponseDto } from '../dto/auth-response.dto';
import { DevLoginDto, LoginStartDto, SwitchWorkspaceDto } from '../dto/login.dto';
import {
  BFF_SESSION_COOKIE,
  BFF_STATE_COOKIE,
  BFF_STATE_COOKIE_MAX_AGE_SECONDS,
} from './bff.constants';

/**
 * Backend-for-Frontend auth surface. Runs the Entra Authorization-Code + PKCE
 * flow server-side and issues an opaque `__Host-` session cookie so tokens
 * never reach the browser. This is rally's only authentication surface.
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

  // ── POST /bff/login/start ──────────────────────────────────────────────────
  // Public: email-first entry for the multi-IdP broker. Resolves the email's
  // federated connection, sets the browser-bound `state` cookie, and returns the
  // IdP authorize URL for the SPA to redirect to. An unknown / unmatched email
  // surfaces as 401 `NO_CONNECTION` ("contact your administrator").
  @Post('login/start')
  @Public()
  @HttpCode(200)
  async loginStart(
    @Body() dto: LoginStartDto,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{ authorizeUrl: string }> {
    const { authorizeUrl, state } = await this.bff.beginLogin(dto.returnTo, dto.email);
    reply.setCookie(BFF_STATE_COOKIE, state, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax', // must survive the top-level redirect back from the IdP
      path: '/',
      maxAge: BFF_STATE_COOKIE_MAX_AGE_SECONDS,
    });
    return { authorizeUrl };
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

  // ── POST /bff/dev-login ──────────────────────────────────────────────────
  // DEV/E2E ONLY (404 in production): passwordless mint of a real server-side
  // session so the same-origin cookie flow can be exercised locally without an
  // Entra tenant. Mirrors POST /v1/auth/dev-login but lands the session on the
  // SERVER (sets the `__Host-` session cookie), not the browser.
  @Post('dev-login')
  @Public()
  @HttpCode(204)
  async devLogin(
    @Body() dto: DevLoginDto,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    if (!this.bff.devLoginAllowed) {
      throw new NotFoundException();
    }
    const sid = await this.bff.devLogin(dto.email, req.ip);
    reply.setCookie(BFF_SESSION_COOKIE, sid, {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      path: '/',
      maxAge: this.bff.sessionTtlSeconds,
    });
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
      phone: profile.phone ?? null,
      role,
      permissions,
      emailVerified: profile.emailVerified,
      createdAt: profile.createdAt.toISOString(),
      updatedAt: profile.updatedAt.toISOString(),
      memberships,
    };
  }

  /** Version-agnostic 302 redirect (avoids Fastify `reply.redirect` arg-order drift). */
  private redirect(reply: FastifyReply, url: string): void {
    reply.header('location', url).status(302).send();
  }
}
