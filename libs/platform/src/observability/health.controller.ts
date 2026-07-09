import { Controller, Get } from '@nestjs/common';
import { HealthCheck, HealthCheckService } from '@nestjs/terminus';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/decorators';
import { SkipRateLimit } from '../rate-limit/rate-limit.decorator';
import { InjectDrizzle } from '../database/drizzle.provider';
import type { DrizzleDB } from '../database/drizzle.provider';
import { sql } from 'drizzle-orm';
import { ValkeyService } from '../cache/valkey.service';
import { AppConfigService } from '../config/app-config.service';

@ApiTags('health')
@Controller()
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    @InjectDrizzle() private readonly db: DrizzleDB,
    private readonly valkey: ValkeyService,
    private readonly config: AppConfigService,
  ) {}

  /**
   * Public runtime config the frontend needs before login — e.g. whether
   * workspace creation is open and whether SSO is available. Contains no secrets.
   */
  @Get('config')
  @Public()
  @SkipRateLimit()
  @ApiOperation({ summary: 'Public runtime config for the frontend (no secrets)' })
  @ApiResponse({
    status: 200,
    schema: {
      properties: {
        workspaceCreationOpen: { type: 'boolean', example: true },
        ssoEnabled: { type: 'boolean', example: true },
      },
    },
  })
  publicConfig() {
    return {
      // Any authenticated user can create a workspace and becomes its admin.
      workspaceCreationOpen: true,
      // SSO is available when an Entra app is configured.
      ssoEnabled: Boolean(this.config.get('ENTRA_TENANT_ID') && this.config.get('ENTRA_CLIENT_ID')),
    };
  }

  /** Liveness probe — is the process alive? */
  @Get('healthz')
  @Public()
  @SkipRateLimit()
  @ApiOperation({ summary: 'Liveness probe — returns ok if process is alive' })
  @ApiResponse({
    status: 200,
    schema: { properties: { status: { type: 'string', example: 'ok' } } },
  })
  healthz() {
    return { status: 'ok' };
  }

  /** Readiness probe — can we serve traffic? (DB + cache reachable) */
  @Get('readyz')
  @Public()
  @SkipRateLimit()
  @HealthCheck()
  @ApiOperation({ summary: 'Readiness probe — checks DB and cache connectivity' })
  @ApiResponse({
    status: 200,
    schema: {
      properties: { status: { type: 'string', example: 'ok' }, details: { type: 'object' } },
    },
  })
  async readyz() {
    return this.health.check([
      async () => {
        try {
          await this.db.execute(sql`SELECT 1`);
          return { postgres: { status: 'up' } };
        } catch (e) {
          return { postgres: { status: 'down', error: String(e) } };
        }
      },
      async () => {
        try {
          await this.valkey.instance.ping();
          return { valkey: { status: 'up' } };
        } catch (e) {
          return { valkey: { status: 'down', error: String(e) } };
        }
      },
    ]);
  }
}
