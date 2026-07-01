import { Body, Controller, Get, HttpCode, Patch, Post, Query, Req, Res } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';
import '@fastify/cookie';
import {
  Auth,
  ApiCommonErrors,
  Public,
  UnauthorizedException,
  RateLimit,
  UseIdempotency,
} from '@platform';
import type { JwtPayload } from '@platform';
import { AuthService } from '../../application/auth.service';
import { AccessService } from '@modules/access';
import { TenancyService } from '@modules/tenancy';
import {
  LoginDto,
  SignupDto,
  ChangePasswordDto,
  UpdateProfileDto,
  ForgotPasswordDto,
  ResetPasswordDto,
  SsoLoginDto,
  SwitchTenantDto,
} from './dto/login.dto';
import { AuthTokenResponseDto, UserProfileResponseDto } from './dto/auth-response.dto';
import { CurrentUser } from './decorators/current-user.decorator';

const REFRESH_COOKIE = 'refresh_token';

const COOKIE_BASE = {
  httpOnly: true,
  path: '/v1/auth',
} as const;

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly accessService: AccessService,
    private readonly tenancyService: TenancyService,
  ) {}

  private buildRefreshCookieOptions(req: FastifyRequest, maxAge: number) {
    const forwardedProto = req.headers['x-forwarded-proto'];
    const isSecureRequest =
      req.protocol === 'https' ||
      (typeof forwardedProto === 'string' &&
        forwardedProto.split(',').some((v) => v.trim() === 'https'));

    const originHeader = req.headers.origin;
    let isCrossSite = false;

    if (typeof originHeader === 'string' && req.headers.host) {
      try {
        isCrossSite = new URL(originHeader).host !== req.headers.host;
      } catch {
        isCrossSite = false;
      }
    }

    const sameSite = isCrossSite ? 'none' : 'lax';
    const secure = isSecureRequest || sameSite === 'none';

    return {
      ...COOKIE_BASE,
      sameSite,
      secure,
      maxAge,
    } as const;
  }

  // ── POST /auth/login ───────────────────────────────────────────────────────

  @Post('login')
  @Public()
  @RateLimit('AUTH_LOGIN')
  @HttpCode(200)
  @ApiOperation({ summary: 'Authenticate with email + password' })
  @ApiResponse({ status: 200, type: AuthTokenResponseDto })
  @ApiCommonErrors(400, 401, 422)
  async login(
    @Body() dto: LoginDto,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<AuthTokenResponseDto> {
    const result = await this.authService.login(dto.email, dto.password, req.ip, dto.rememberMe);

    // Cookie TTL mirrors the session TTL: 30d if remembered, 24h otherwise
    const cookieMaxAge = dto.rememberMe ? 30 * 24 * 60 * 60 : 24 * 60 * 60;
    reply.setCookie(
      REFRESH_COOKIE,
      result.refreshToken,
      this.buildRefreshCookieOptions(req, cookieMaxAge),
    );

    return {
      accessToken: result.accessToken,
      expiresIn: result.expiresIn,
      user: result.user,
      memberships: result.memberships,
    };
  }

  // ── POST /auth/signup ───────────────────────────────────────────────────────

  @Post('signup')
  @Public()
  @RateLimit('AUTH_LOGIN')
  @HttpCode(201)
  @ApiOperation({ summary: 'Self-serve signup — create or join a tenant by email domain' })
  @ApiResponse({ status: 201, type: AuthTokenResponseDto })
  @ApiCommonErrors(400, 409, 422)
  async signup(
    @Body() dto: SignupDto,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<AuthTokenResponseDto> {
    const result = await this.authService.signup(
      {
        email: dto.email,
        password: dto.password,
        displayName: dto.displayName,
        organizationName: dto.organizationName,
      },
      req.ip,
    );

    reply.setCookie(
      REFRESH_COOKIE,
      result.refreshToken,
      this.buildRefreshCookieOptions(req, 24 * 60 * 60),
    );

    return {
      accessToken: result.accessToken,
      expiresIn: result.expiresIn,
      user: result.user,
      memberships: result.memberships,
    };
  }

  // ── POST /auth/sso ─────────────────────────────────────────────────────────

  @Post('sso')
  @Public()
  @RateLimit('AUTH_LOGIN')
  @HttpCode(200)
  @ApiOperation({ summary: 'Authenticate with Microsoft Entra ID (SSO)' })
  @ApiResponse({ status: 200, type: AuthTokenResponseDto })
  @ApiCommonErrors(400, 401, 422)
  async ssoLogin(
    @Body() dto: SsoLoginDto,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<AuthTokenResponseDto> {
    const result = await this.authService.ssoLogin(dto.idToken, req.ip);

    reply.setCookie(
      REFRESH_COOKIE,
      result.refreshToken,
      this.buildRefreshCookieOptions(req, 30 * 24 * 60 * 60),
    );

    return {
      accessToken: result.accessToken,
      expiresIn: result.expiresIn,
      user: result.user,
      memberships: result.memberships,
    };
  }

  // ── POST /auth/refresh ─────────────────────────────────────────────────────

  @Post('refresh')
  @Public()
  @RateLimit('AUTH_REFRESH')
  @HttpCode(200)
  @ApiOperation({ summary: 'Rotate refresh token and issue new access token' })
  @ApiResponse({
    status: 200,
    schema: { properties: { accessToken: { type: 'string' }, expiresIn: { type: 'number' } } },
  })
  @ApiCommonErrors(401)
  async refresh(
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<Omit<AuthTokenResponseDto, 'user' | 'memberships'>> {
    const token =
      req.cookies && typeof req.cookies === 'object'
        ? (req.cookies as Record<string, string | undefined>)[REFRESH_COOKIE]
        : undefined;
    if (!token) {
      throw new UnauthorizedException('AUTH_TOKEN_INVALID', 'Refresh token missing');
    }

    const result = await this.authService.refresh(token, req.ip);

    reply.setCookie(
      REFRESH_COOKIE,
      result.refreshToken,
      this.buildRefreshCookieOptions(req, 30 * 24 * 60 * 60),
    );

    return { accessToken: result.accessToken, expiresIn: result.expiresIn };
  }

  // ── POST /auth/logout ──────────────────────────────────────────────────────

  // ── POST /auth/switch-tenant ───────────────────────────────────────────────

  @Post('switch-tenant')
  @Auth()
  @HttpCode(200)
  @RateLimit('AUTH_REFRESH')
  @ApiOperation({ summary: 'Switch active tenant and re-issue tokens' })
  @ApiResponse({
    status: 200,
    schema: { properties: { accessToken: { type: 'string' }, expiresIn: { type: 'number' } } },
  })
  @ApiCommonErrors(401, 403)
  async switchTenant(
    @Body() dto: SwitchTenantDto,
    @CurrentUser() user: JwtPayload,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<Omit<AuthTokenResponseDto, 'user' | 'memberships'>> {
    const result = await this.authService.switchTenant(user, dto.tenantId, req.ip);

    reply.setCookie(
      REFRESH_COOKIE,
      result.refreshToken,
      this.buildRefreshCookieOptions(req, 30 * 24 * 60 * 60),
    );

    return { accessToken: result.accessToken, expiresIn: result.expiresIn };
  }

  @Post('logout')
  @Auth()
  @HttpCode(204)
  @ApiOperation({ summary: 'Revoke current session and access token' })
  @ApiResponse({ status: 204, description: 'Session revoked' })
  @ApiCommonErrors(401)
  async logout(
    @CurrentUser() user: JwtPayload,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    await this.authService.logout(user);
    reply.clearCookie(REFRESH_COOKIE, { path: COOKIE_BASE.path });
  }

  // ── GET /auth/me ───────────────────────────────────────────────────────────

  @Get('me')
  @Auth()
  @ApiOperation({ summary: 'Get authenticated user profile' })
  @ApiResponse({ status: 200, type: UserProfileResponseDto })
  @ApiCommonErrors(401)
  async getMe(@CurrentUser() user: JwtPayload): Promise<UserProfileResponseDto> {
    const [profile, { role, permissions }, memberships] = await Promise.all([
      this.authService.getMe(user.sub),
      this.accessService.getUserRoleAndPermissions(user.sub, user.tenantId),
      this.tenancyService.getMemberships(user.sub),
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

  // ── PATCH /auth/me ─────────────────────────────────────────────────────────

  @Patch('me')
  @Auth()
  @ApiOperation({ summary: 'Update authenticated user profile' })
  @ApiResponse({ status: 200, type: UserProfileResponseDto })
  @ApiCommonErrors(400, 401, 422)
  async updateProfile(
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateProfileDto,
  ): Promise<UserProfileResponseDto> {
    const [profile, { role, permissions }, memberships] = await Promise.all([
      this.authService.updateProfile(user.sub, dto),
      this.accessService.getUserRoleAndPermissions(user.sub, user.tenantId),
      this.tenancyService.getMemberships(user.sub),
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

  // ── PATCH /auth/password ───────────────────────────────────────────────────

  @Patch('password')
  @Auth()
  @HttpCode(204)
  @ApiOperation({ summary: 'Change authenticated user password' })
  @ApiResponse({ status: 204, description: 'Password changed' })
  @ApiCommonErrors(400, 401, 422)
  async changePassword(
    @CurrentUser() user: JwtPayload,
    @Body() dto: ChangePasswordDto,
  ): Promise<void> {
    await this.authService.changePassword(user.sub, dto.currentPassword, dto.newPassword);
  }

  // ── POST /auth/logout-all ──────────────────────────────────────────────────

  @Post('logout-all')
  @Auth()
  @HttpCode(204)
  @ApiOperation({ summary: 'Revoke all sessions for the authenticated user' })
  @ApiResponse({ status: 204, description: 'All sessions revoked' })
  @ApiCommonErrors(401)
  async logoutAll(
    @CurrentUser() user: JwtPayload,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    await this.authService.logoutAll(user);
    reply.clearCookie(REFRESH_COOKIE, { path: COOKIE_BASE.path });
  }

  // ── POST /auth/forgot-password ─────────────────────────────────────────────

  @Post('forgot-password')
  @Public()
  @RateLimit('AUTH_FORGOT')
  @UseIdempotency()
  @HttpCode(200)
  @ApiOperation({ summary: 'Request a password reset link (always returns 200)' })
  @ApiResponse({
    status: 200,
    schema: {
      properties: {
        message: { type: 'string' },
        devResetUrl: {
          type: 'string',
          description: 'Dev-only: reset URL (not present in production)',
        },
      },
    },
  })
  async forgotPassword(
    @Body() dto: ForgotPasswordDto,
  ): Promise<{ message: string; devResetUrl?: string }> {
    const result = await this.authService.forgotPassword(dto.email);
    return {
      message: 'If that email exists, a password reset link has been sent.',
      ...(result.devResetUrl ? { devResetUrl: result.devResetUrl } : {}),
    };
  }

  // ── GET /auth/verify-reset-token ─────────────────────────────────────────────
  // Read-only — validates token state without consuming it.
  // Enterprise: called on reset-password page mount so users see expired/invalid
  // errors immediately, before filling in the form.

  @Get('verify-reset-token')
  @Public()
  @RateLimit('AUTH_FORGOT')
  @HttpCode(200)
  @ApiOperation({ summary: 'Validate a password-reset token without consuming it' })
  @ApiResponse({
    status: 200,
    schema: {
      properties: {
        valid: { type: 'boolean' },
        reason: {
          type: 'string',
          enum: ['invalid', 'expired', 'used'],
          description: 'Only present when valid=false',
        },
      },
    },
  })
  async verifyResetToken(
    @Query('token') token: string,
  ): Promise<{ valid: boolean; reason?: 'invalid' | 'expired' | 'used' }> {
    if (!token) return { valid: false, reason: 'invalid' };
    return this.authService.verifyResetToken(token);
  }

  // ── POST /auth/reset-password ──────────────────────────────────────────────

  @Post('reset-password')
  @Public()
  @RateLimit('AUTH_FORGOT')
  @HttpCode(204)
  @ApiOperation({ summary: 'Reset password using a token from forgot-password email' })
  @ApiResponse({ status: 204, description: 'Password reset successful' })
  @ApiCommonErrors(400, 401, 422)
  async resetPassword(@Body() dto: ResetPasswordDto): Promise<void> {
    await this.authService.resetPassword(dto.token, dto.newPassword);
  }
}
