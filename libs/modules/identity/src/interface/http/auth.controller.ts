import { Body, Controller, HttpCode, Patch, Post, Res } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import '@fastify/cookie';
import { Auth, ApiCommonErrors, BFF_SESSION_COOKIE, ConflictException } from '@platform';
import type { JwtPayload } from '@platform';
import { AuthService } from '@qnsc-vn/identity';
import { AccessService, SelfScoped } from '@modules/access';
import { WorkspaceService } from '@modules/workspace';
import { AttachmentsService, USER_AVATAR_POLICY } from '@modules/attachments';
import { UpdateProfileDto } from './dto/login.dto';
import { UserProfileResponseDto } from './dto/auth-response.dto';
import {
  PresignAvatarDto,
  PresignAvatarResponseDto,
  ConfirmAvatarDto,
  ConfirmAvatarResponseDto,
} from './dto/avatar.dto';
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
    private readonly attachments: AttachmentsService,
  ) {}

  // ── PATCH /auth/me ─────────────────────────────────────────────────────────

  @Patch('me')
  @SelfScoped("updates the caller's own profile")
  @Auth()
  @ApiOperation({ summary: 'Update authenticated user profile' })
  @ApiResponse({ status: 200, type: UserProfileResponseDto })
  @ApiCommonErrors(400, 401, 422)
  async updateProfile(
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateProfileDto,
  ): Promise<UserProfileResponseDto> {
    const [profile, { role, permissions }, memberships, settings] = await Promise.all([
      this.authService.updateProfile(user.sub, dto),
      this.accessService.getUserRoleAndPermissions(user.sub, user.workspaceId),
      this.workspaceService.getMemberships(user.sub),
      this.workspaceService.getSettings(user.workspaceId).catch(() => null),
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
      workspaceDefaults: settings
        ? {
            timezone: settings.timezone,
            locale: settings.defaultLocale,
            dateFormat: settings.dateFormat,
          }
        : null,
    };
  }

  // ── POST /auth/me/avatar/presign ────────────────────────────────────────────

  // Avatar upload reuses the shared AttachmentsService + USER_AVATAR_POLICY
  // (public bucket, 2 MB raster cap, maxPerOwner 1) — the same presign → PUT →
  // confirm mechanics as work-item attachments. The avatar has no link table in
  // identity (it is just a URL on the user row), so `currentOwnerCount` is 0:
  // each upload mints a fresh object and the old one is reaped.
  @Post('me/avatar/presign')
  @SelfScoped("presigns an upload for the caller's own avatar")
  @Auth()
  @ApiOperation({ summary: 'Presign a PUT URL to upload the current user avatar' })
  @ApiResponse({ status: 201, type: PresignAvatarResponseDto })
  @ApiCommonErrors(400, 401, 409, 422)
  async presignAvatar(
    @CurrentUser() user: JwtPayload,
    @Body() dto: PresignAvatarDto,
  ): Promise<PresignAvatarResponseDto> {
    const { fileId, uploadUrl, requiredHeaders } = await this.attachments.presign(
      user,
      USER_AVATAR_POLICY,
      {
        filename: 'avatar',
        mimeType: dto.contentType,
        sizeBytes: dto.contentLength,
        checksumSha256: dto.checksumSha256,
      },
      0,
    );
    return { fileId, uploadUrl, requiredHeaders };
  }

  // ── POST /auth/me/avatar/confirm ────────────────────────────────────────────

  @Post('me/avatar/confirm')
  @SelfScoped("confirms the caller's own avatar upload")
  @Auth()
  @ApiOperation({ summary: 'Confirm the uploaded avatar and store it on the profile' })
  @ApiResponse({ status: 201, type: ConfirmAvatarResponseDto })
  @ApiCommonErrors(400, 401, 404, 409, 422)
  async confirmAvatar(
    @CurrentUser() user: JwtPayload,
    @Body() dto: ConfirmAvatarDto,
  ): Promise<ConfirmAvatarResponseDto> {
    await this.attachments.confirm(user, dto.fileId, USER_AVATAR_POLICY);
    const { url, expiresInSeconds } = await this.attachments.getDownloadUrl(
      user,
      dto.fileId,
      USER_AVATAR_POLICY,
    );
    // A public policy resolves to a durable CDN URL (expiresInSeconds === 0). A
    // positive TTL means no CDN is configured, so the URL is a short-lived
    // presigned GET — unsuitable to persist as a stable avatarUrl. Fail clearly
    // rather than store an expiring link.
    if (expiresInSeconds > 0) {
      throw new ConflictException(
        'AVATAR_STORAGE_UNCONFIGURED',
        'Avatar storage is not configured (no public CDN base URL).',
      );
    }
    await this.authService.updateProfile(user.sub, { avatarUrl: url });
    return { avatarUrl: url };
  }

  // ── POST /auth/logout-all ──────────────────────────────────────────────────

  @Post('logout-all')
  @SelfScoped("revokes the caller's own sessions")
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
