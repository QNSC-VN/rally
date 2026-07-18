import { Body, Controller, HttpCode, Patch, Post, Res } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import '@fastify/cookie';
import { Auth, ApiCommonErrors, BFF_SESSION_COOKIE } from '@platform';
import type { JwtPayload } from '@platform';
import { AuthService } from '@qnsc-vn/identity';
import { AccessService } from '@modules/access';
import { WorkspaceService } from '@modules/workspace';
import { UpdateProfileDto } from './dto/login.dto';
import { UserProfileResponseDto } from './dto/auth-response.dto';
import { CurrentUser } from './decorators/current-user.decorator';

/**
 * Current-user profile surface. All authentication and session lifecycle lives
 * in the BFF controller (`/v1/bff/*`); this controller only exposes the profile
 * update and the "sign out everywhere" action, both authenticated via the shared
 * session-cookie guard.
 */
@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly accessService: AccessService,
    private readonly workspaceService: WorkspaceService,
  ) {}

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
    // Under the BFF flow the browser holds only the opaque session cookie; drop
    // it so the current device is signed out immediately alongside the others.
    reply.clearCookie(BFF_SESSION_COOKIE, { path: '/' });
  }
}
